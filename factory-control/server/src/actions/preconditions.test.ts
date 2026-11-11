import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { guardFor } from "./preconditions.ts";
import type { ActionContext } from "./types.ts";
import type { CheckState, FactorySnapshot, Unit, UnitPr } from "../types.ts";

function prOf(number: number, state: string, checks: CheckState): UnitPr {
  return { number, state, checks, url: "" };
}

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

function makeSnapshot(units: Unit[], orphaned: Partial<FactorySnapshot["orphaned"]> = {}): FactorySnapshot {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    repo: { root: "/tmp/fixture", branch: "main", dirty: false },
    units,
    issues: [],
    agents: [],
    prs: [],
    orphaned: {
      branches: [],
      worktrees: [],
      handoffs: [],
      prs: [],
      ...orphaned,
    },
    errors: [],
  };
}

function ctx(c: Partial<ActionContext> = {}): ActionContext {
  const result: ActionContext = {
    snapshot: makeSnapshot([]),
    unitId: "t1fx",
    override: false,
    root: false,
  };
  if (c.snapshot !== undefined) result.snapshot = c.snapshot;
  if (c.unitId !== undefined) result.unitId = c.unitId;
  if (c.prNumber !== undefined) result.prNumber = c.prNumber;
  if (c.override !== undefined) result.override = c.override;
  if (c.root !== undefined) result.root = c.root;
  return result;
}

function names(preconditions: { name: string; ok: boolean }[]): string[] {
  return preconditions.map((p) => p.name);
}

const reviewHandoff = { source: "result" as const, agent: "t1fx-review", definition: "pr-reviewer" };
const qaHandoff = { source: "result" as const, agent: "t1fx-qa", definition: "qa-tester" };
const actingAgent = {
  label: "t1fx-impl",
  definition: "builder",
  state: "working" as const,
  availableTools: [],
  source: "mailbox" as const,
};

test("worktree/create: passes when SPEC exists, no branch/worktree, no live agent", () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const preconditions = guardFor("worktree/create", ctx({ snapshot: makeSnapshot([unit]) }));
  assert.ok(preconditions.every((p) => p.ok), JSON.stringify(preconditions));
  assert.deepEqual(names(preconditions), ["unit-found", "spec-exists", "no-branch", "no-worktree", "no-live-agent"]);
});

test("worktree/create: fails each guard with a reason", () => {
  // No SPEC file.
  const noSpec = guardFor("worktree/create", ctx({ snapshot: makeSnapshot([baseUnit()]) }));
  assert.equal(noSpec.find((p) => p.name === "spec-exists")?.ok, false);

  // Existing branch (attached).
  const attachedBranch = guardFor(
    "worktree/create",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", branch: "factory/t1fx" })]) }),
  );
  assert.equal(attachedBranch.find((p) => p.name === "no-branch")?.ok, false);

  // Existing branch (orphaned).
  const orphanBranch = guardFor(
    "worktree/create",
    ctx({
      snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })], { branches: ["factory/t1fx"] }),
    }),
  );
  assert.equal(orphanBranch.find((p) => p.name === "no-branch")?.ok, false);

  // Existing worktree.
  const withWorktree = guardFor(
    "worktree/create",
    ctx({
      snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: "/tmp/wt", dirty: false } })]),
    }),
  );
  assert.equal(withWorktree.find((p) => p.name === "no-worktree")?.ok, false);

  // Live agent acting (overlaps the writer on this unit).
  const liveAgent = guardFor(
    "worktree/create",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", agents: [actingAgent] })]) }),
  );
  assert.equal(liveAgent.find((p) => p.name === "no-live-agent")?.ok, false);

  // Unknown unit.
  const unknown = guardFor("worktree/create", ctx({ unitId: "nope", snapshot: makeSnapshot([]) }));
  assert.equal(unknown[0]?.ok, false);
});

test("worktree/remove: requires merged+green unless override", () => {
  const mergedGreen = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(1, "MERGED", "green"),
  });
  const ok = guardFor("worktree/remove", ctx({ snapshot: makeSnapshot([mergedGreen]) }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  const open = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(1, "OPEN", "green"),
  });
  const denied = guardFor("worktree/remove", ctx({ snapshot: makeSnapshot([open]) }));
  const merged = denied.find((p) => p.name === "merged-or-override");
  assert.equal(merged?.ok, false);
  assert.match(merged?.detail ?? "", /override/);

  const overridden = guardFor("worktree/remove", ctx({ snapshot: makeSnapshot([open]), override: true }));
  assert.ok(overridden.every((p) => p.ok), JSON.stringify(overridden));

  // Live agent blocks even with override.
  const liveAgent = guardFor(
    "worktree/remove",
    ctx({ snapshot: makeSnapshot([{ ...open, agents: [actingAgent] }]), override: true }),
  );
  assert.equal(liveAgent.find((p) => p.name === "no-live-agent")?.ok, false);
});

test("checks/run: worktree path wins; root flag only without a worktree", () => {
  const worktreePath = mkdtempSync(join(tmpdir(), "factory-pc-wt-"));
  const withWorktree = baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: worktreePath, dirty: false } });
  const ok = guardFor("checks/run", ctx({ snapshot: makeSnapshot([withWorktree]) }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  // Root flag + worktree exists → refused (primary checkout protection).
  const rootWithWorktree = guardFor("checks/run", ctx({ snapshot: makeSnapshot([withWorktree]), root: true }));
  const notRoot = rootWithWorktree.find((p) => p.name === "not-root-when-worktree");
  assert.equal(notRoot?.ok, false);
  assert.match(notRoot?.detail ?? "", /primary checkout/);

  // No worktree, no root → fail.
  const noWorktree = guardFor("checks/run", ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]) }));
  assert.equal(noWorktree.find((p) => p.name === "worktree-or-root")?.ok, false);

  // No worktree + root → ok.
  const rootOnly = guardFor(
    "checks/run",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]), root: true }),
  );
  assert.ok(rootOnly.every((p) => p.ok), JSON.stringify(rootOnly));

  // Worktree path missing on disk → treated as absent.
  const missingDir = baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: "/nonexistent/wt", dirty: false } });
  const missingWorktree = guardFor("checks/run", ctx({ snapshot: makeSnapshot([missingDir]) }));
  assert.equal(missingWorktree.find((p) => p.name === "worktree-or-root")?.ok, false);
});

test("pr/open: requires branch + review + QA handoffs", () => {
  const ready = baseUnit({ specPath: "SPEC/T1-fx.md", branch: "factory/t1fx", handoffs: [reviewHandoff, qaHandoff] });
  const ok = guardFor("pr/open", ctx({ snapshot: makeSnapshot([ready]) }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  const noReview = guardFor(
    "pr/open",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", branch: "factory/t1fx", handoffs: [qaHandoff] })]) }),
  );
  assert.equal(noReview.find((p) => p.name === "review-handoff")?.ok, false);

  const noQa = guardFor(
    "pr/open",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", branch: "factory/t1fx", handoffs: [reviewHandoff] })]) }),
  );
  assert.equal(noQa.find((p) => p.name === "qa-handoff")?.ok, false);

  const noBranch = guardFor(
    "pr/open",
    ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", handoffs: [reviewHandoff, qaHandoff] })]) }),
  );
  assert.equal(noBranch.find((p) => p.name === "branch-exists")?.ok, false);
});

test("checks/query: requires a PR", () => {
  const withPr = baseUnit({ specPath: "SPEC/T1-fx.md", pr: prOf(1, "OPEN", "green") });
  const ok = guardFor("checks/query", ctx({ snapshot: makeSnapshot([withPr]) }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  const noPr = guardFor("checks/query", ctx({ snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]) }));
  assert.equal(noPr.find((p) => p.name === "pr-exists")?.ok, false);
});

test("pr/merge: requires open PR + green checks + review/QA handoffs", () => {
  const ready = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(1, "OPEN", "green"),
    handoffs: [reviewHandoff, qaHandoff],
  });
  const ok = guardFor("pr/merge", ctx({ snapshot: makeSnapshot([ready]) }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  const merged = { ...ready, pr: prOf(1, "MERGED", "green") };
  const notOpen = guardFor("pr/merge", ctx({ snapshot: makeSnapshot([merged]) }));
  assert.equal(notOpen.find((p) => p.name === "pr-open")?.ok, false);

  const red = { ...ready, pr: prOf(1, "OPEN", "red") };
  const notGreen = guardFor("pr/merge", ctx({ snapshot: makeSnapshot([red]) }));
  assert.equal(notGreen.find((p) => p.name === "checks-green")?.ok, false);

  const noReview = { ...ready, handoffs: [qaHandoff] };
  const missingReview = guardFor("pr/merge", ctx({ snapshot: makeSnapshot([noReview]) }));
  assert.equal(missingReview.find((p) => p.name === "review-handoff")?.ok, false);

  const noQa = { ...ready, handoffs: [reviewHandoff] };
  const missingQa = guardFor("pr/merge", ctx({ snapshot: makeSnapshot([noQa]) }));
  assert.equal(missingQa.find((p) => p.name === "qa-handoff")?.ok, false);
});

test("main/merge: requires override:true + green CI + review/QA handoffs", () => {
  const ready = baseUnit({
    specPath: "SPEC/T1-fx.md",
    pr: prOf(1, "OPEN", "green"),
    handoffs: [reviewHandoff, qaHandoff],
  });
  const ok = guardFor("main/merge", ctx({ snapshot: makeSnapshot([ready]), override: true }));
  assert.ok(ok.every((p) => p.ok), JSON.stringify(ok));

  const noOverride = guardFor("main/merge", ctx({ snapshot: makeSnapshot([ready]), override: false }));
  assert.equal(noOverride.find((p) => p.name === "override-required")?.ok, false);

  const noPr = guardFor(
    "main/merge",
    ctx({
      snapshot: makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", handoffs: [reviewHandoff, qaHandoff] })]),
      override: true,
    }),
  );
  assert.equal(noPr.find((p) => p.name === "branch-ci-green")?.ok, false);

  const red = { ...ready, pr: prOf(1, "OPEN", "red") };
  const notGreen = guardFor("main/merge", ctx({ snapshot: makeSnapshot([red]), override: true }));
  assert.equal(notGreen.find((p) => p.name === "branch-ci-green")?.ok, false);

  const missingReview = guardFor(
    "main/merge",
    ctx({ snapshot: makeSnapshot([{ ...ready, handoffs: [qaHandoff] }]), override: true }),
  );
  assert.equal(missingReview.find((p) => p.name === "review-handoff")?.ok, false);
});
