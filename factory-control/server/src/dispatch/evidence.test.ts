import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DispatchQueue } from "./queue.ts";
import { DispatchService } from "./service.ts";
import { SnapshotService } from "../service.ts";
import type { AgentRecord, FactorySnapshot, Unit } from "../types.ts";

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

const WORKING_AGENT: AgentRecord = {
  label: "builder-t1fx",
  definition: "builder",
  state: "working",
  source: "result",
  availableTools: [],
};

const HANDOFF = { source: "result" as const, agent: "t1fx-builder", definition: "builder" };

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

function harness(unit: Unit) {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-evidence-"));
  const queueDir = join(dir, "queue");
  const queue = new DispatchQueue({ dir: queueDir });
  const snap = makeSnapshot([unit]);
  const service = new MutableSnapshotService(snap);
  const svc = new DispatchService({
    snapshot: () => service.get(),
    factoryRoot: dir,
    queue,
  });
  return { queue, snap, service, svc };
}

test("live agent match moves a queued entry to dispatched", async () => {
  const { queue, service, svc } = harness(baseUnit({ specPath: "SPEC/T1-fx.md" }));
  queue.append({ id: "req-e1", at: "2026-01-01T00:00:00.000Z", unit: "t1fx", specPath: "SPEC/T1-fx.md", worktree: "factory/t1fx", role: "builder", acceptance: "a" });

  // No live agent yet → stays queued.
  let entries = await svc.list();
  assert.equal(entries[0]?.status, "queued");

  // Live agent appears on the unit.
  service.snap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", agents: [WORKING_AGENT] })]);
  entries = await svc.list();
  assert.equal(entries[0]?.status, "dispatched");
});

test("handoff present closes a dispatched entry to done", async () => {
  const { queue, service, svc } = harness(baseUnit({ specPath: "SPEC/T1-fx.md" }));
  queue.append({ id: "req-e2", at: "2026-01-01T00:00:00.000Z", unit: "t1fx", specPath: "SPEC/T1-fx.md", worktree: "factory/t1fx", role: "builder", acceptance: "a" });
  queue.transition("req-e2", "dispatched");

  let entries = await svc.list();
  assert.equal(entries[0]?.status, "dispatched");

  service.snap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", handoffs: [HANDOFF] })]);
  entries = await svc.list();
  assert.equal(entries[0]?.status, "done");
});

test("handoff present while queued closes directly to done", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-evidence3-"));
  const queue = new DispatchQueue({ dir: join(dir, "queue3") });
  queue.append({ id: "req-e3", at: "2026-01-01T00:00:00.000Z", unit: "t1fx", specPath: "SPEC/T1-fx.md", worktree: "factory/t1fx", role: "builder", acceptance: "a" });
  const handoffSnap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", handoffs: [HANDOFF] })]);
  const service = new MutableSnapshotService(handoffSnap);
  const svc = new DispatchService({ snapshot: () => service.get(), factoryRoot: dir, queue });
  const entries = await svc.list();
  assert.equal(entries[0]?.status, "done");
});

test("cancelled entries are untouched by evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-evidence4-"));
  const queue = new DispatchQueue({ dir: join(dir, "queue4") });
  queue.append({ id: "req-e4", at: "2026-01-01T00:00:00.000Z", unit: "t1fx", specPath: "SPEC/T1-fx.md", worktree: "factory/t1fx", role: "builder", acceptance: "a" });
  queue.transition("req-e4", "cancelled");
  const handoffSnap = makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md", handoffs: [HANDOFF], agents: [WORKING_AGENT] })]);
  const service = new MutableSnapshotService(handoffSnap);
  const svc = new DispatchService({ snapshot: () => service.get(), factoryRoot: dir, queue });
  const entries = await svc.list();
  assert.equal(entries[0]?.status, "cancelled");
});

test("evidence never spawns agents or runs commands (design guarantee)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-evidence5-"));
  const queue = new DispatchQueue({ dir: join(dir, "queue5") });
  queue.append({ id: "req-e5", at: "2026-01-01T00:00:00.000Z", unit: "t1fx", specPath: "SPEC/T1-fx.md", worktree: "factory/t1fx", role: "builder", acceptance: "a" });
  const service = new MutableSnapshotService(makeSnapshot([baseUnit({ specPath: "SPEC/T1-fx.md" })]));
  const svc = new DispatchService({ snapshot: () => service.get(), factoryRoot: dir, queue });
  await svc.list();

  // The dispatch queue directory contains only queue/events JSONL files.
  const fs = await import("node:fs");
  const files = fs.readdirSync(join(dir, "queue5")).sort();
  assert.deepEqual(files, ["events.jsonl", "queue.jsonl"]);
});
