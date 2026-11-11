import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DispatchService } from "./service.ts";
import { SnapshotService } from "../service.ts";
import type { FactorySnapshot, Unit } from "../types.ts";
import type { StartWorkEnqueueRequest } from "./types.ts";

function issueUnit(number = 42, title = "Add leaderboard"): Unit {
  return {
    id: `issue${number}`,
    kind: "issue",
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
    title,
    issue: {
      number,
      title,
      state: "open",
      url: `https://github.com/acme/demo/issues/${number}`,
      labels: { blocked: false, followUp: false, playtest: false, raw: [] },
      assignees: [],
    },
  };
}

function makeSnapshot(units: Unit[], errors: string[] = []): FactorySnapshot {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    repo: { root: "/tmp/fixture", branch: "main", dirty: false },
    units,
    issues: [],
    agents: [],
    prs: [],
    orphaned: { branches: [], worktrees: [], handoffs: [], prs: [] },
    errors,
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

function serviceFor(snap: FactorySnapshot): DispatchService {
  return new DispatchService({
    snapshot: () => new StubSnapshotService(snap).get(),
    factoryRoot: mkdtempSync(join(tmpdir(), "factory-dispatch-startwork-")),
  });
}

function req(overrides: Partial<StartWorkEnqueueRequest> = {}): StartWorkEnqueueRequest {
  return {
    sourceUnit: "issue42",
    unit: "issue42",
    specPath: "SPEC/issue42-add-leaderboard.md",
    worktree: "factory/issue42",
    role: "builder",
    acceptance: "Implement issue42 per SPEC/issue42-add-leaderboard.md; npm run check green.",
    ...overrides,
  };
}

test("enqueueStartWork appends a queued entry and returns a delegation prompt", async () => {
  const svc = serviceFor(makeSnapshot([issueUnit()]));
  const outcome = await svc.enqueueStartWork(req());
  assert.equal(outcome.kind, "ok");
  if (outcome.kind !== "ok") throw new Error("unreachable");
  assert.equal(outcome.entry.status, "queued");
  assert.equal(outcome.entry.unit, "issue42");
  assert.equal(outcome.entry.specPath, "SPEC/issue42-add-leaderboard.md");
  assert.equal(outcome.entry.worktree, "factory/issue42");
  assert.equal(outcome.entry.role, "builder");
  assert.ok(outcome.entry.acceptance?.includes("npm run check"));
  assert.ok(outcome.prompt.includes("delegate_agent"));
  assert.ok(outcome.prompt.includes("factory/issue42"));
  assert.ok(outcome.prompt.includes("SPEC/issue42-add-leaderboard.md"));

  const entries = (await svc.list()).filter((e) => e.status === "queued");
  assert.equal(entries.length, 1);
});

test("enqueueStartWork rejects invalid ids, empty fields, or a missing source unit", async () => {
  const svc = serviceFor(makeSnapshot([issueUnit()]));
  const badIds = ["a/../b", "a b", "/etc/passwd", "..", "a\\b", ""];
  for (const bad of badIds) {
    const out = await svc.enqueueStartWork(req({ sourceUnit: bad }));
    assert.equal(out.kind, "rejected", `sourceUnit ${JSON.stringify(bad)}`);
  }
  for (const bad of badIds) {
    const out = await svc.enqueueStartWork(req({ unit: bad }));
    assert.equal(out.kind, "rejected", `unit ${JSON.stringify(bad)}`);
  }
  for (const field of ["specPath", "worktree", "role", "acceptance"] as const) {
    const out = await svc.enqueueStartWork(req({ [field]: "" }));
    assert.equal(out.kind, "rejected", field);
  }
  const missing = await svc.enqueueStartWork(req({ sourceUnit: "issue999" }));
  assert.equal(missing.kind, "rejected");
  if (missing.kind === "rejected") assert.match(missing.reason, /no longer present/);
});

test("enqueueStartWork rejects a second active entry for the same source unit (S2)", async () => {
  const svc = serviceFor(makeSnapshot([issueUnit()]));
  const first = await svc.enqueueStartWork(req());
  assert.equal(first.kind, "ok");
  const second = await svc.enqueueStartWork(req());
  assert.equal(second.kind, "rejected");
  if (second.kind === "rejected") assert.match(second.reason, /already exists/);
  const entries = await svc.list();
  assert.equal(entries.length, 1, "only one entry was appended");
});

test("enqueueStartWork rejects when a live agent is acting on the source unit", async () => {
  const unit = issueUnit();
  unit.agents = [{ label: "issue42-builder", definition: "builder", state: "working", source: "mailbox", availableTools: [] }];
  const svc = serviceFor(makeSnapshot([unit]));
  const out = await svc.enqueueStartWork(req());
  assert.equal(out.kind, "rejected");
  if (out.kind === "rejected") assert.match(out.reason, /live agent/);
});
