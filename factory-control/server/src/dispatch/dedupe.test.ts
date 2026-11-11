import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DispatchQueue } from "./queue.ts";
import { DispatchService } from "./service.ts";
import { SnapshotService } from "../service.ts";
import type { FactorySnapshot, Unit } from "../types.ts";

function baseUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "t1fx",
    kind: "spec",
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
    issues: [],
    agents: [],
    prs: [],
    orphaned: { branches: [], worktrees: [], handoffs: [], prs: [] },
    errors: [],
  };
}

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

function mutableService(unit: Unit): { service: MutableSnapshotService; svc: DispatchService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "factory-dispatch-s2-"));
  const service = new MutableSnapshotService(makeSnapshot([unit]));
  const svc = new DispatchService({ snapshot: () => service.get(), factoryRoot: dir });
  return { service, svc, dir };
}

test("S2: second prepare is rejected while an active entry exists for the unit", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { svc } = mutableService(unit);
  const first = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(first.kind === "ok" && first.ok);
  const enq = await svc.enqueue(first.requestId);
  assert.equal(enq.kind, "ok");

  const second = await svc.prepare({ unit: "t1fx" }, {});
  assert.equal(second.kind, "active-entry");
  if (second.kind === "active-entry") {
    assert.match(second.error, /already exists/);
  }

  // A skill prepare for the same unit is equally blocked.
  const skill = await svc.prepare({ unit: "t1fx", skill: "qa-tester" }, {});
  assert.equal(skill.kind, "active-entry");
});

test("S2: prepare is allowed after the entry reaches done", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { svc } = mutableService(unit);
  const first = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(first.kind === "ok");
  if (first.kind !== "ok") throw new Error("unreachable");
  const enq = await svc.enqueue(first.requestId);
  assert.equal(enq.kind, "ok");
  if (enq.kind !== "ok") throw new Error("unreachable");

  const dispatched = await svc.status(enq.entry.id, "dispatched");
  assert.equal(dispatched.kind, "ok");
  const done = await svc.status(enq.entry.id, "done");
  assert.equal(done.kind, "ok");

  const again = await svc.prepare({ unit: "t1fx" }, {});
  assert.equal(again.kind, "ok");
});

test("S2: prepare is allowed after the entry is cancelled", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { svc } = mutableService(unit);
  const first = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(first.kind === "ok");
  if (first.kind !== "ok") throw new Error("unreachable");
  const enq = await svc.enqueue(first.requestId);
  assert.equal(enq.kind, "ok");
  if (enq.kind !== "ok") throw new Error("unreachable");

  const cancelled = await svc.status(enq.entry.id, "cancelled");
  assert.equal(cancelled.kind, "ok");

  const again = await svc.prepare({ unit: "t1fx" }, {});
  assert.equal(again.kind, "ok");
});

test("S2: enqueue is rejected when an active entry appears after prepare (dedupe TOCTOU)", async () => {
  const unit = baseUnit({ specPath: "SPEC/T1-fx.md" });
  const { svc, dir } = mutableService(unit);
  const first = await svc.prepare({ unit: "t1fx" }, {});
  assert.ok(first.kind === "ok" && first.ok);

  // Inject an active entry for the same unit between prepare and enqueue.
  const queue = new DispatchQueue({ dir: join(dir, "factory-control", "state", "dispatch-queue") });
  queue.append({
    id: "req-intruder",
    at: "2026-01-01T00:00:00.000Z",
    unit: "t1fx",
    worktree: "factory/t1fx",
    role: "builder",
    acceptance: "a",
  });

  const enq = await svc.enqueue(first.requestId);
  assert.equal(enq.kind, "rejected");
  if (enq.kind === "rejected") {
    assert.match(enq.reason, /already exists/);
  }
  assert.equal((await svc.list()).length, 1, "only the intruder entry exists");
});
