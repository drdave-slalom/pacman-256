import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSnapshot } from "./snapshot.ts";
import type { FactorySnapshot, Unit } from "./types.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeSpec(repo: string, name: string, title: string): void {
  writeFileSync(join(repo, "SPEC", name), `# ${title}\n\n**Status:** Test fixture\n\n## Goal\n\nFixture goal for ${title}.\n`);
}

function herdrFixture(results: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "factory-snap-herdr-"));
  mkdirSync(join(root, "results"), { recursive: true });
  mkdirSync(join(root, "runtime", "mailboxes-v5"), { recursive: true });
  mkdirSync(join(root, "result-ref-reservations"), { recursive: true });
  for (const [name, body] of Object.entries(results)) {
    writeFileSync(join(root, "results", name), body);
  }
  return root;
}

interface Harness {
  parent: string;
  repo: string;
  cleanup: () => void;
}

function makeFixtureRepo(): Harness {
  const parent = mkdtempSync(join(tmpdir(), "factory-snap-repo-"));
  const repo = join(parent, "repo");
  mkdirSync(join(repo, "SPEC"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test Builder");
  writeSpec(repo, "T3-foo.md", "T3 spec: private rooms and synchronized movement");
  writeSpec(repo, "T5-bar.md", "T5 spec: countdown contact round end");
  writeSpec(repo, "unbalanced-baz.md", "Unbalanced lobbies");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base specs");
  return { parent, repo, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

test("integration: fixture repo → stage assignment, flags, orphan bucket", async (t) => {
  const harness = makeFixtureRepo();
  t.after(harness.cleanup);
  const { repo } = harness;

  // factory/t3 branch + worktree (T3 unit), plus an orphan branch.
  git(repo, "checkout", "-q", "-b", "factory/t3");
  writeFileSync(join(repo, "feature.txt"), "t3 change\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "t3 feature");
  git(repo, "checkout", "-q", "main");
  git(repo, "branch", "factory/orphan-thing");
  const worktree = join(harness.parent, "wt-fc-t3");
  git(repo, "worktree", "add", "-q", worktree, "factory/t3");

  // Herdr fixture: T3 has an implementation + review handoff.
  const herdr = herdrFixture({
    "0001": 'Agent result source: {"agent":"t3-impl","definition":"builder","cwd":"/tmp","piSessionId":"s1"}\n\nImpl done.\n',
    "0002": 'Agent result source: {"agent":"t3-review","definition":"pr-reviewer","cwd":"/tmp","piSessionId":"s2"}\n\nReview done.\n',
    "0003": 'Agent result source: {"agent":"zzz-nomatch","definition":"qa-tester","cwd":"/tmp","piSessionId":"s3"}\n\nLonely.\n',
  });

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = herdr;
  let snapshot: FactorySnapshot;
  try {
    snapshot = await buildSnapshot({ root: repo, noGh: true });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }

  assert.equal(snapshot.units.length, 3);

  const t3 = snapshot.units.find((unit) => unit.id === "t3foo");
  assert.ok(t3, "T3 unit present");
  // Implementation + review handoffs present, QA absent → qa stage (rule 5).
  assert.equal(t3.stage, "qa");
  assert.equal(t3.flags.qaPending, true);
  assert.equal(t3.branch, "factory/t3");
  assert.ok(t3.worktree);
  assert.equal(t3.worktree.path, worktree);
  assert.equal(t3.handoffs.length, 2);

  const t5 = snapshot.units.find((unit) => unit.id === "t5bar");
  assert.ok(t5, "T5 unit present");
  assert.equal(t5.stage, "spec");
  assert.equal(t5.flags.needsDispatch, true);

  assert.ok(snapshot.orphaned.branches.includes("factory/orphan-thing"));
  assert.equal(snapshot.orphaned.handoffs.length, 1);
  assert.equal(snapshot.orphaned.worktrees.length, 0);
});

test("integration: no crash on missing herdr dirs and missing gh", async (t) => {
  const harness = makeFixtureRepo();
  t.after(harness.cleanup);

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(harness.parent, "does-not-exist");
  let snapshot: FactorySnapshot;
  try {
    snapshot = await buildSnapshot({ root: harness.repo, noGh: true });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }

  assert.equal(snapshot.units.length, 3);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.prs, []);
});

test("integration: unreadable spec still listed with parseError", async (t) => {
  const harness = makeFixtureRepo();
  t.after(harness.cleanup);
  const repo = join(harness.parent, "repo2");
  mkdirSync(join(repo, "SPEC"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "SPEC", "broken.md"), "# Broken\n");
  // Replace the file with an unreadable directory of the same name after commit.
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "spec");
  rmSync(join(repo, "SPEC", "broken.md"));
  mkdirSync(join(repo, "SPEC", "broken.md"));

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(harness.parent, "nope");
  let units: Unit[];
  try {
    units = (await buildSnapshot({ root: repo, noGh: true })).units;
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }

  const broken = units.find((unit) => unit.id === "broken");
  assert.ok(broken);
  assert.ok(broken.parseError);
  assert.ok(broken.attention.includes("parse-error"));
});

test("integration: remote origin/factory/* branches join units, dedupe, and orphan", async (t) => {
  const harness = makeFixtureRepo();
  t.after(harness.cleanup);
  const { repo } = harness;

  // Local factory/t3 branch (matches unit T3-foo).
  git(repo, "checkout", "-q", "-b", "factory/t3");
  writeFileSync(join(repo, "feature.txt"), "t3 change\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "t3 feature");
  git(repo, "checkout", "-q", "main");

  // Remote-tracking refs (no actual remote configured):
  //  - origin/factory/t3 duplicates the local branch → must not double-assign.
  //  - origin/factory/t9 matches a remote-only unit (T9-remote).
  //  - origin/factory/orphan-only matches nothing → orphaned.
  writeSpec(repo, "T9-remote.md", "T9 spec: remote branch join");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "add T9 spec");
  const mainHead = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/factory/t3", mainHead);
  git(repo, "update-ref", "refs/remotes/origin/factory/t9", mainHead);
  git(repo, "update-ref", "refs/remotes/origin/factory/orphan-only", mainHead);

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(harness.parent, "nope");
  let snapshot: FactorySnapshot;
  try {
    snapshot = await buildSnapshot({ root: repo, noGh: true });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }

  const t3 = snapshot.units.find((unit) => unit.id === "t3foo");
  assert.ok(t3, "T3 unit present");
  // (b) local wins and the remote duplicate does not overwrite it.
  assert.equal(t3.branch, "factory/t3");

  // (a) remote-only branch joins its unit.
  const t9 = snapshot.units.find((unit) => unit.id === "t9remote");
  assert.ok(t9, "T9 remote unit present");
  assert.equal(t9.branch, "origin/factory/t9");
  assert.equal(t9.stage, "dispatch");

  // (c) remote-only branch with no unit lands in the orphan bucket.
  assert.ok(snapshot.orphaned.branches.includes("origin/factory/orphan-only"));
});

test("integration: current-branch facts reflect the repo", async (t) => {
  const harness = makeFixtureRepo();
  t.after(harness.cleanup);
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(harness.parent, "nope");
  try {
    const snapshot = await buildSnapshot({ root: harness.repo, noGh: true });
    assert.equal(snapshot.repo.root, realpathSync(harness.repo));
    assert.equal(snapshot.repo.branch, "main");
    assert.equal(snapshot.repo.dirty, false);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});
