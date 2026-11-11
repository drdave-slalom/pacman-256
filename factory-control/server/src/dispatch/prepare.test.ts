import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DispatchService, type DispatchPrepareOutcome } from "./service.ts";
import { SnapshotService } from "../service.ts";
import type { AgentRecord, FactorySnapshot, Unit, UnitPr } from "../types.ts";

function baseUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "t1fx",
    stage: "spec",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: true,
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
    agents: [],
    prs: [],
    orphaned: { branches: [], worktrees: [], handoffs: [], prs: [] },
    errors: [],
  };
}

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

const WORKING_AGENT: AgentRecord = {
  label: "builder-t1fx",
  definition: "builder",
  state: "working",
  source: "result",
  availableTools: [],
};

const HANDOFF = { source: "result" as const, agent: "t1fx-builder", definition: "builder" };

function serviceFor(snap: FactorySnapshot, factoryRoot = "/tmp/fixture"): DispatchService {
  return new DispatchService({
    snapshot: () => new StubSnapshotService(snap).get(),
    factoryRoot,
  });
}

async function prepareOk(svc: DispatchService, body: { unit?: string; skill?: string }): Promise<{ ok: boolean; preconditions: { name: string; ok: boolean }[]; plan: { kind: string; role: string; worktree: string; specPath?: string; skill?: string; contextRefs?: string[]; acceptance: string; delegationPrompt: string }; requestId: string; entryId: string }> {
  const out = await svc.prepare(body, {});
  assert.equal(out.kind, "ok", JSON.stringify(out));
  if (out.kind !== "ok") throw new Error("unreachable");
  return out;
}

test("dispatch prepare accepts a spec unit with no active writer/worktree", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const svc = serviceFor(makeSnapshot([unit]));
  const out = await prepareOk(svc, { unit: "T1-fx" });
  assert.equal(out.ok, true);
  assert.ok(out.preconditions.every((p) => p.ok));
  assert.equal(out.plan.kind, "dispatch");
  assert.equal(out.plan.role, "builder");
  assert.equal(out.plan.worktree, "factory/t1fx");
  assert.equal(out.plan.specPath, "SPEC/T1-fx.md");
  assert.ok(out.plan.acceptance.includes("t1fx"));
  assert.ok(out.plan.delegationPrompt.includes("delegate_agent"));
  assert.match(out.entryId, /^req-/);
  assert.ok(out.requestId.length > 0);
});

test("dispatch prepare rejects a unit without a SPEC file", async () => {
  const unit = baseUnit(); // no specPath
  const out = await prepareOk(serviceFor(makeSnapshot([unit])), { unit: "t1fx" });
  assert.equal(out.ok, false);
  const spec = out.preconditions.find((p) => p.name === "spec-exists");
  assert.ok(spec);
  assert.equal(spec?.ok, false);
});

test("dispatch prepare rejects a unit with an active worktree", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: "/wt/t1fx", dirty: false } });
  const out = await prepareOk(serviceFor(makeSnapshot([unit])), { unit: "t1fx" });
  assert.equal(out.ok, false);
  const wt = out.preconditions.find((p) => p.name === "no-worktree");
  assert.ok(wt);
  assert.equal(wt?.ok, false);
});

test("dispatch prepare rejects a unit with a live agent", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md", agents: [WORKING_AGENT] });
  const out = await prepareOk(serviceFor(makeSnapshot([unit])), { unit: "t1fx" });
  assert.equal(out.ok, false);
  const agent = out.preconditions.find((p) => p.name === "no-live-agent");
  assert.ok(agent);
  assert.equal(agent?.ok, false);
});

test("dispatch prepare rejects a unit with an existing branch (attached or orphaned)", async () => {
  const attached = baseUnit({ specPath: "SPEC/T1-fx.md", branch: "factory/t1fx" });
  const out1 = await prepareOk(serviceFor(makeSnapshot([attached])), { unit: "t1fx" });
  assert.equal(out1.ok, false);
  assert.equal(out1.preconditions.find((p) => p.name === "no-branch")?.ok, false);

  const snapshot = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]);
  snapshot.orphaned.branches = ["origin/factory/t1fx"];
  const out2 = await prepareOk(serviceFor(snapshot), { unit: "t1fx" });
  assert.equal(out2.ok, false);
  assert.equal(out2.preconditions.find((p) => p.name === "no-branch")?.ok, false);
});

test("dispatch prepare rejects unknown units and invalid unit ids", async () => {
  const svc = serviceFor(makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]));
  const unknown = await svc.prepare({ unit: "does-not-exist" }, {});
  assert.equal(unknown.kind, "unknown-unit");
  for (const bad of ["a/../b", "a b", "/etc/passwd", "..", "a\\b", ""]) {
    const out = await svc.prepare({ unit: bad }, {});
    assert.equal(out.kind, "invalid-input", `unit ${JSON.stringify(bad)}`);
  }
});

test("skill prepare: qa-tester on a qa stage unit", async () => {
  const unit = baseUnit({
    id: "t2qa",
    specPath: "SPEC/T2-qa.md",
    stage: "qa",
    flags: { ...baseUnit().flags, qaPending: true },
    branch: "factory/t2qa",
    worktree: { path: "/wt/t2qa", dirty: false },
    handoffs: [{ definition: "builder", source: "result" }],
  });
  const svc = serviceFor(makeSnapshot([unit]));
  const out = await prepareOk(svc, { unit: "t2qa", skill: "qa-tester" });
  assert.equal(out.ok, true);
  assert.equal(out.plan.kind, "skill");
  assert.equal(out.plan.skill, "qa-tester");
  assert.equal(out.plan.role, "qa-tester");
  assert.ok(out.plan.contextRefs?.includes(".github/skills/qa-tester/SKILL.md"));
  assert.ok(out.plan.delegationPrompt.includes("qa-tester"));
});

test("skill prepare rejects a skill on a non-eligible unit", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" }); // spec stage, not qa
  const out = await prepareOk(serviceFor(makeSnapshot([unit])), { unit: "t1fx", skill: "qa-tester" });
  assert.equal(out.ok, false);
  const eligible = out.preconditions.find((p) => p.name === "skill-eligible");
  assert.ok(eligible);
  assert.equal(eligible?.ok, false);
});

test("skill prepare: open-pr requires a branch and no open PR", async () => {
  const ready = baseUnit({
    id: "t3pr",
    specPath: "SPEC/T3-pr.md",
    stage: "integrate",
    branch: "factory/t3pr",
    worktree: { path: "/wt/t3pr", dirty: false },
  });
  const ok = await prepareOk(serviceFor(makeSnapshot([ready])), { unit: "t3pr", skill: "open-pr" });
  assert.equal(ok.ok, true);

  const hasPr: UnitPr = { number: 9, state: "OPEN", checks: "green", url: "" };
  const withPr = baseUnit({ ...ready, pr: hasPr });
  const blocked = await prepareOk(serviceFor(makeSnapshot([withPr])), { unit: "t3pr", skill: "open-pr" });
  assert.equal(blocked.ok, false);
});

test("unknown skill → unknown-skill", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const out = await serviceFor(makeSnapshot([unit])).prepare({ unit: "t1fx", skill: "no-such-skill" }, {});
  assert.equal(out.kind, "unknown-skill");
});

test("enqueue persists the prepared entry; one-shot requestId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-prepare-"));
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const svc2 = new DispatchService({
    snapshot: () => new StubSnapshotService(makeSnapshot([unit])).get(),
    factoryRoot: dir,
  });
  const prep = await svc2.prepare({ unit: "t1fx" }, { operator: "lead" });
  assert.ok(prep.kind === "ok");
  const requestId = prep.requestId;
  const enq = await svc2.enqueue(requestId);
  assert.equal(enq.kind, "ok");
  if (enq.kind !== "ok") throw new Error("unreachable");
  assert.equal(enq.entry.status, "queued");
  assert.equal(enq.entry.id, prep.entryId);
  assert.equal(enq.entry.unit, "t1fx");
  assert.ok(enq.prompt.includes("delegate_agent"));

  // one-shot: second enqueue with same requestId fails
  const again = await svc2.enqueue(requestId);
  assert.equal(again.kind, "no-prepare");

  // The queue file exists under the factory-control/state/dispatch-queue dir.
  const fs = await import("node:fs");
  const queueFile = join(dir, "factory-control", "state", "dispatch-queue", "queue.jsonl");
  assert.ok(fs.existsSync(queueFile));
});

test("prepare builds a delegation prompt with spec, worktree, role, acceptance", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const out = await prepareOk(serviceFor(makeSnapshot([unit])), { unit: "t1fx" });
  const prompt = out.plan.delegationPrompt;
  assert.ok(prompt.includes("SPEC/T1-fx.md"));
  assert.ok(prompt.includes("factory/t1fx"));
  assert.ok(prompt.includes("builder"));
  assert.ok(prompt.includes("Acceptance:"));
});

class MutableSnapshotService extends SnapshotService {
  snap: FactorySnapshot;
  constructor(snap: FactorySnapshot) {
    super({ root: "", noGh: true });
    this.snap = snap;
  }
  override async get(): Promise<FactorySnapshot> {
    return this.snap;
  }
}

function mutableService(unit: Unit): { service: MutableSnapshotService; svc: DispatchService } {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-s1-"));
  const service = new MutableSnapshotService(makeSnapshot([unit]));
  const svc = new DispatchService({ snapshot: () => service.get(), factoryRoot: dir });
  return { service, svc };
}

test("S1: enqueue rejects a prepare that did not pass preconditions", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: "/wt/t1fx", dirty: false } });
  const { svc } = mutableService(unit);
  const prep = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(prep.kind === "ok");
  assert.equal(prep.ok, false);
  const enq = await svc.enqueue(prep.requestId);
  assert.equal(enq.kind, "rejected");
  if (enq.kind === "rejected") {
    assert.match(enq.reason, /prepare did not pass/);
    assert.ok((enq.preconditions ?? []).some((p) => p.name === "no-worktree" && !p.ok));
  }
  assert.equal((await svc.list()).length, 0, "nothing was enqueued");
});

test("S1: enqueue rejects a prepare whose unit gained a live agent before enqueue (TOCTOU)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { service, svc } = mutableService(unit);
  const prep = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(prep.kind === "ok" && prep.ok === true);
  service.snap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", agents: [WORKING_AGENT] })]);
  const enq = await svc.enqueue(prep.requestId);
  assert.equal(enq.kind, "rejected");
  if (enq.kind === "rejected") {
    assert.match(enq.reason, /state changed/);
    assert.ok((enq.preconditions ?? []).some((p) => p.name === "no-live-agent" && !p.ok));
  }
  assert.equal((await svc.list()).length, 0);
});

test("S1: enqueue rejects a prepare whose unit gained a worktree before enqueue (TOCTOU)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { service, svc } = mutableService(unit);
  const prep = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(prep.kind === "ok" && prep.ok === true);
  service.snap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", worktree: { path: "/wt/t1fx", dirty: false } })]);
  const enq = await svc.enqueue(prep.requestId);
  assert.equal(enq.kind, "rejected");
  assert.equal((await svc.list()).length, 0);
});
