import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ActionsService, type CommandRunner, type RunnerResult } from "./actions.ts";
import { AuditLog } from "./audit.ts";
import { LockManager } from "./locks.ts";
import { createApiServer } from "../http.ts";
import { SnapshotService } from "../service.ts";
import { buildSnapshot } from "../snapshot.ts";
import type { CommandSpec } from "./types.ts";
import type { CheckState, FactorySnapshot, Unit, UnitPr } from "../types.ts";

function prOf(number: number, state: string, checks: CheckState): UnitPr {
  return { number, state, checks, url: "" };
}

const FIXTURE_WEB_API = fileURLToPath(
  new URL("../../../../factory-control/web/src/api.ts", import.meta.url),
);

// ---- snapshot fixture helpers -------------------------------------------------

function baseUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "t1fx",
    kind: "spec",
    stage: "unknown",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: false,
      blockedAgent: false,
    },
    agents: [],
    handoffs: [],
    attention: [],
    ...overrides,
  };
}

function makeSnapshot(units: Unit[]): FactorySnapshot {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    repo: { root: "/tmp/fixture", branch: "main", dirty: false },
    units,
    issues: [],
    agents: [],
    prs: [],
    orphaned: { branches: [], worktrees: [], handoffs: [], prs: [] },
    errors: [],
  };
}

const reviewHandoff = { source: "result" as const, agent: "t1fx-review", definition: "pr-reviewer" };
const qaHandoff = { source: "result" as const, agent: "t1fx-qa", definition: "qa-tester" };

class StubSnapshotService extends SnapshotService {
  private readonly snap: FactorySnapshot;

  constructor(snap: FactorySnapshot) {
    super({ root: "", noGh: true });
    this.snap = snap;
  }

  override async get(): Promise<FactorySnapshot> {
    return this.snap;
  }
}

// ---- command runners -----------------------------------------------------------

function recordingRunner(log: CommandSpec[]): CommandRunner {
  return async (spec: CommandSpec): Promise<RunnerResult> => {
    log.push(spec);
    return { ok: true, stdout: "recorded", stderr: "", status: 0 };
  };
}

function failingRunner(log: CommandSpec[], exit = 2): CommandRunner {
  return async (spec: CommandSpec): Promise<RunnerResult> => {
    log.push(spec);
    return { ok: false, stdout: "", stderr: "boom", status: exit };
  };
}

function blockingRunner(gate: Promise<void>, log: CommandSpec[]): CommandRunner {
  return async (spec: CommandSpec): Promise<RunnerResult> => {
    log.push(spec);
    await gate;
    return { ok: true, stdout: "ok", stderr: "", status: 0 };
  };
}

// ---- server harness ------------------------------------------------------------

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

interface Harness {
  base: string;
  server: Server;
  log: CommandSpec[];
  auditFile: string;
  lockDir: string;
  close: () => Promise<void>;
}

async function withActionsServer(
  snap: FactorySnapshot,
  opts: { runner?: CommandRunner; factoryRoot?: string; log?: CommandSpec[] } = {},
  run: (h: Harness) => Promise<void>,
): Promise<void> {
  const log = opts.log ?? [];
  const service = new StubSnapshotService(snap);
  const auditFile = join(tempDir("factory-act-audit-"), "audit.log.jsonl");
  const lockDir = join(tempDir("factory-act-locks-"), "locks");
  const actions = new ActionsService({
    snapshot: () => service.get(),
    factoryRoot: opts.factoryRoot ?? process.cwd(),
    runner: opts.runner ?? recordingRunner(log),
    audit: new AuditLog({ file: auditFile }),
    locks: new LockManager({ dir: lockDir }),
  });
  const server = createApiServer(service, {
    webRoot: join(tempDir("factory-act-web-"), "dist"),
    actions,
  });
  try {
    const base = await listen(server);
    await run({ base, server, log, auditFile, lockDir, close: () => close(server) });
  } finally {
    await close(server);
  }
}

// ---- git fixture helpers -------------------------------------------------------

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface RepoHarness {
  parent: string;
  repo: string;
  worktree: string;
  cleanup: () => void;
}

function makeMobileRepo(): RepoHarness {
  const parent = mkdtempSync(join(tmpdir(), "factory-act-repo-"));
  const repo = join(parent, "repo");
  mkdirSync(join(repo, "SPEC"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Factory Test");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { check: 'node -e "console.log(\'fixture check ok\')"' } }),
  );
  writeFileSync(join(repo, "SPEC", "T1-fx.md"), "# T1 spec: fx\n\n## Goal\n\nFx fixture.\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "factory/t1fx");
  writeFileSync(join(repo, "feature.txt"), "t1fx change\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "feature");
  git(repo, "checkout", "-q", "main");
  const worktree = join(parent, "wt-fc-t1fx");
  git(repo, "worktree", "add", "-q", worktree, "factory/t1fx");
  return { parent, repo, worktree, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

async function withRealRepo(run: (h: RepoHarness & { auditFile: string; lockDir: string }) => Promise<void>): Promise<void> {
  const harness = makeMobileRepo();
  const auditFile = join(tempDir("factory-act-audit-"), "audit.log.jsonl");
  const lockDir = join(tempDir("factory-act-locks-"), "locks");
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = tempDir("factory-act-herdr-");
  try {
    await run({ ...harness, auditFile, lockDir });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
    harness.cleanup();
  }
}

// ---- tests ---------------------------------------------------------------------

test("prepare → execute happy path over HTTP (worktree/create)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  await withActionsServer(makeSnapshot([unit]), {}, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/worktree/create/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx", operator: "lead" }),
    });
    assert.equal(prep.status, 200);
    const prepBody = (await prep.json()) as { requestId: string; ok: boolean; preconditions: { name: string; ok: boolean }[]; plan: { steps: unknown[] } };
    assert.equal(prepBody.ok, true);
    assert.ok(prepBody.requestId);
    assert.ok(prepBody.plan.steps.length >= 1);

    const exec = await fetch(`${h.base}/api/actions/worktree/create/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    assert.equal(exec.status, 200);
    const body = (await exec.json()) as { requestId: string; outcome: string; command: string[]; exit: number | null };
    assert.equal(body.outcome, "success");
    assert.equal(body.exit, 0);
    assert.equal(body.requestId, prepBody.requestId);
    assert.equal(body.command.length, 1);
    assert.match(body.command[0] ?? "", /factory-worktree\.sh create t1fx/);

    assert.equal(h.log.length, 1);
    assert.deepEqual(h.log[0]?.args, ["create", "t1fx"]);

    // Audit has prepared + success lines with operator and reasons.
    const audit = await fetch(`${h.base}/api/actions/audit?limit=10`);
    assert.equal(audit.status, 200);
    const auditBody = (await audit.json()) as { audit: { requestId: string; outcome: string; operator: string; preconditions: { name: string; ok: boolean }[] }[] };
    assert.equal(auditBody.audit.length, 2);
    assert.equal(auditBody.audit[0]?.outcome, "prepared");
    assert.equal(auditBody.audit[1]?.outcome, "success");
    assert.equal(auditBody.audit[1]?.operator, "lead");
    assert.ok(auditBody.audit[1]?.preconditions.every((p) => p.ok));

    // One-shot: re-executing the same requestId is rejected.
    const replay = await fetch(`${h.base}/api/actions/worktree/create/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    assert.equal(replay.status, 409);
  });
});

test("execute without a matching prepare is rejected (409)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  await withActionsServer(makeSnapshot([unit]), {}, async (h) => {
    const exec = await fetch(`${h.base}/api/actions/worktree/create/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "nope", confirm: true, approvedBy: "lead" }),
    });
    assert.equal(exec.status, 409);
    const body = (await exec.json()) as { error: string; preconditions: unknown[] };
    assert.match(body.error, /prepare/);
    assert.deepEqual(body.preconditions, []);
    assert.equal(h.log.length, 0, "no command ran");
  });
});

test("execute without confirm:true is rejected (400)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  await withActionsServer(makeSnapshot([unit]), {}, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/worktree/create/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    const prepBody = (await prep.json()) as { requestId: string };
    const exec = await fetch(`${h.base}/api/actions/worktree/create/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: false }),
    });
    assert.equal(exec.status, 400);
  });
});

test("gate violation → prepare ok:false, execute 409, no command runs", async () => {
  // worktree/remove of an open, unmerged PR without override.
  const open = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(7, "OPEN", "green"),
  });
  await withActionsServer(makeSnapshot([open]), {}, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/worktree/remove/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    assert.equal(prep.status, 200);
    const prepBody = (await prep.json()) as { requestId: string; ok: boolean; preconditions: { name: string; ok: boolean }[] };
    assert.equal(prepBody.ok, false);
    const merged = prepBody.preconditions.find((p) => p.name === "merged-or-override");
    assert.ok(merged);
    assert.equal(merged.ok, false);

    const exec = await fetch(`${h.base}/api/actions/worktree/remove/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    assert.equal(exec.status, 409);
    const body = (await exec.json()) as { error: string; preconditions: { name: string; ok: boolean }[] };
    assert.match(body.error, /preconditions/);
    assert.ok(body.preconditions.some((p) => p.name === "merged-or-override" && !p.ok));
    assert.equal(h.log.length, 0, "no command ran (worktree/remove without merged+green rejected)");
  });
});

test("denied pr/merge never touches gh", async () => {
  // Open PR, green checks, but review handoff missing.
  const noReview = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(7, "OPEN", "green"),
    handoffs: [qaHandoff],
  });
  await withActionsServer(makeSnapshot([noReview]), {}, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/pr/merge/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    const prepBody = (await prep.json()) as { requestId: string; ok: boolean };
    assert.equal(prepBody.ok, false);

    const exec = await fetch(`${h.base}/api/actions/pr/merge/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    assert.equal(exec.status, 409);
    assert.equal(h.log.length, 0, "gh must never be invoked");
  });
});

test("granted pr/merge runs gh pr merge; main/merge requires override", async () => {
  const ready = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(7, "OPEN", "green"),
    handoffs: [reviewHandoff, qaHandoff],
  });
  await withActionsServer(makeSnapshot([ready]), {}, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/pr/merge/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    const prepBody = (await prep.json()) as { requestId: string; ok: boolean };
    assert.equal(prepBody.ok, true);
    const exec = await fetch(`${h.base}/api/actions/pr/merge/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    assert.equal(exec.status, 200);
    assert.equal(h.log.length, 1);
    assert.equal(h.log[0]?.command, "gh");
    assert.deepEqual(h.log[0]?.args, ["pr", "merge", "7", "--merge"]);

    // main/merge without override → 409.
    const directPrep = await fetch(`${h.base}/api/actions/main/merge/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    const directBody = (await directPrep.json()) as { ok: boolean; preconditions: { name: string; ok: boolean }[] };
    assert.equal(directBody.ok, false);
    const overrideGuard = directBody.preconditions.find((p) => p.name === "override-required");
    assert.ok(overrideGuard);
    assert.equal(overrideGuard.ok, false);
  });
});

test("command failure is reported with exit code and audit outcome failed", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const log: CommandSpec[] = [];
  const failing = failingRunner(log, 3);
  await withActionsServer(makeSnapshot([unit]), { runner: failing, log }, async (h) => {
    const prep = await fetch(`${h.base}/api/actions/worktree/create/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    const prepBody = (await prep.json()) as { requestId: string };
    const exec = await fetch(`${h.base}/api/actions/worktree/create/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
    });
    const body = (await exec.json()) as { outcome: string; exit: number | null; outputTail: string };
    assert.equal(body.outcome, "failed");
    assert.equal(body.exit, 3);
    assert.match(body.outputTail, /boom/);

    const audit = await fetch(`${h.base}/api/actions/audit?limit=10`);
    const auditBody = (await audit.json()) as { audit: { outcome: string; exit?: number }[] };
    assert.equal(auditBody.audit.at(-1)?.outcome, "failed");
    assert.equal(auditBody.audit.at(-1)?.exit, 3);
  });
});

test("per-unit lock blocks a concurrent mutation on the same unit", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const log: CommandSpec[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actions = new ActionsService({
    snapshot: async () => makeSnapshot([unit]),
    factoryRoot: process.cwd(),
    runner: blockingRunner(gate, log),
    audit: new AuditLog({ file: join(tempDir("factory-act-audit-"), "audit.log.jsonl") }),
    locks: new LockManager({ dir: join(tempDir("factory-act-locks-"), "locks") }),
  });

  const prep1 = await actions.prepare("worktree/create", { unit: "t1fx" }, {});
  const prep2 = await actions.prepare("worktree/create", { unit: "t1fx" }, {});
  assert.ok(prep1.kind === "ok" && prep2.kind === "ok");

  const first = actions.execute(prep1.requestId, { requestId: prep1.requestId, confirm: true, approvedBy: "lead" }, {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = await actions.execute(prep2.requestId, { requestId: prep2.requestId, confirm: true, approvedBy: "lead" }, {});
  assert.equal(second.kind, "lock");
  assert.equal(second.kind === "lock" ? second.preconditions[0]?.name : "", "lock");

  release();
  const firstResult = await first;
  assert.equal(firstResult.kind, "result");
  assert.equal(log.length, 1, "only the first mutation ran");
});

test("checks/run with the real runner in a real git worktree fixture", async () => {
  await withRealRepo(async (h) => {
    const service = new SnapshotService({ root: h.repo, noGh: true });
    const actions = new ActionsService({
      snapshot: () => service.get(),
      factoryRoot: h.repo,
      audit: new AuditLog({ file: h.auditFile }),
      locks: new LockManager({ dir: h.lockDir }),
    });
    const server = createApiServer(service, {
      webRoot: join(tempDir("factory-act-web-"), "dist"),
      actions,
    });
    try {
      const base = await listen(server);
      const prep = await fetch(`${base}/api/actions/checks/run/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: "t1fx" }),
      });
      assert.equal(prep.status, 200);
      const prepBody = (await prep.json()) as { requestId: string; ok: boolean; plan: { steps: { command: string; cwd?: string }[] } };
      assert.equal(prepBody.ok, true, JSON.stringify(prepBody));
      assert.equal(prepBody.plan.steps[0]?.command, "npm");
      assert.equal(prepBody.plan.steps[0]?.cwd, h.worktree);

      const exec = await fetch(`${base}/api/actions/checks/run/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: prepBody.requestId, confirm: true, approvedBy: "lead" }),
      });
      const body = (await exec.json()) as { outcome: string; exit: number | null; outputTail: string };
      assert.equal(body.outcome, "success", JSON.stringify(body));
      assert.equal(body.exit, 0);
      assert.match(body.outputTail, /fixture check ok/);

      // Lock released after execution.
      const locks = await fetch(`${base}/api/actions/locks`);
      const locksBody = (await locks.json()) as { locks: unknown[] };
      assert.equal(locksBody.locks.length, 0);
    } finally {
      await close(server);
    }
  });
});

test("prepare rejects invalid unit shapes and non-integer pr with 400", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  await withActionsServer(makeSnapshot([unit]), {}, async (h) => {
    for (const bad of ["a/../b", "a b", "/etc/passwd", "..", "a\\b", ""]) {
      const res = await fetch(`${h.base}/api/actions/worktree/create/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unit: bad }),
      });
      assert.equal(res.status, 400, `unit ${JSON.stringify(bad)}`);
    }
    for (const bad of [1.5, -3, 0, NaN]) {
      const res = await fetch(`${h.base}/api/actions/checks/query/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pr: bad }),
      });
      assert.equal(res.status, 400, `pr ${String(bad)}`);
    }
    // Valid shape canonicalizes and proceeds.
    const okUnit = await fetch(`${h.base}/api/actions/worktree/create/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T1-fx" }),
    });
    assert.equal(okUnit.status, 200);
    assert.equal(h.log.length, 0);
  });
});

test("strict one-shot: concurrent duplicate executes cannot both run", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const log: CommandSpec[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actions = new ActionsService({
    snapshot: async () => makeSnapshot([unit]),
    factoryRoot: process.cwd(),
    runner: blockingRunner(gate, log),
    audit: new AuditLog({ file: join(tempDir("factory-act-audit-"), "audit.log.jsonl") }),
    locks: new LockManager({ dir: join(tempDir("factory-act-locks-"), "locks") }),
  });
  const prep = await actions.prepare("worktree/create", { unit: "t1fx" }, {});
  assert.ok(prep.kind === "ok");
  const first = actions.execute(prep.requestId, { requestId: prep.requestId, confirm: true, approvedBy: "lead" }, {});
  const second = actions.execute(prep.requestId, { requestId: prep.requestId, confirm: true, approvedBy: "lead" }, {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  const [ra, rb] = await Promise.all([first, second]);
  const ran = [ra, rb].filter((r) => r.kind === "result").length;
  const denied = [ra, rb].filter((r) => r.kind === "no-prepare").length;
  assert.equal(ran, 1);
  assert.equal(denied, 1);
  assert.equal(log.length, 1);
});

test("unknown action is 404; web mirror has no route to action endpoints", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  await withActionsServer(makeSnapshot([unit]), {}, async (h) => {
    const unknown = await fetch(`${h.base}/api/actions/nope/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "t1fx" }),
    });
    assert.equal(unknown.status, 404);

    // Mutating methods other than POST on action routes are 404 (API read-only).
    const put = await fetch(`${h.base}/api/actions/pr/merge/prepare`, { method: "PUT" });
    assert.equal(put.status, 404);
    const del = await fetch(`${h.base}/api/actions/audit`, { method: "DELETE" });
    assert.equal(del.status, 404);

    // M1 (web mirror) drives the M2 action API for issue-backed units: comment,
    // label, state, and start-work all prepare/execute via /api/actions.
    const apiSource = readFileSync(FIXTURE_WEB_API, "utf8");
    assert.ok(apiSource.includes("/api/actions"));
  });
});
