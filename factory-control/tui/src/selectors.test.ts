import test from "node:test";
import assert from "node:assert/strict";
import { fixtureSnapshot } from "./fixtures.ts";
import {
  buildBoard,
  flattenUnits,
  formatAge,
  formatElapsed,
  pipelineStages,
  showBranch,
  summarizeAttention,
  unitById,
} from "./selectors.ts";

test("buildBoard groups units by stage column and sorts by id", () => {
  const model = buildBoard(fixtureSnapshot());
  const byKey = new Map(model.columns.map((c) => [c.key, c]));
  assert.equal(byKey.get("spec")?.units.length, 1);
  assert.equal(byKey.get("execute")?.units.length, 1);
  assert.equal(byKey.get("review")?.units.length, 1);
  assert.equal(byKey.get("done")?.units.length, 1);
  assert.equal(byKey.get("unknown")?.units.length, 0);
  assert.equal(byKey.get("execute")?.units[0]?.id, "T2-execute");
  assert.deepEqual(model.orphaned.branches, ["origin/factory/orphan1"]);
  assert.deepEqual(model.orphaned.worktrees, ["/tmp/wt-orphan"]);
});

test("buildBoard honors a filter query", () => {
  const model = buildBoard(fixtureSnapshot(), "t3");
  const units = flattenUnits(model);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.id, "T3-review");
});

test("pipelineStages lists the eight stages in order with live counts", () => {
  const stages = pipelineStages(buildBoard(fixtureSnapshot()));
  assert.deepEqual(stages.map((s) => s.title), ["Spec", "Dispatch", "Execute", "Review", "QA", "Integrate", "CI", "Done"]);
  assert.deepEqual(stages.map((s) => s.count), [1, 0, 1, 1, 0, 0, 0, 1]);
});

test("flattenUnits follows column order", () => {
  const flat = flattenUnits(buildBoard(fixtureSnapshot()));
  assert.deepEqual(flat.map((u) => u.id), ["T1-spec", "T2-execute", "T3-review", "T4-merged"]);
});

test("summarizeAttention aggregates across units", () => {
  const summary = summarizeAttention(fixtureSnapshot());
  assert.equal(summary.total, 4);
  const needs = summary.counts.find((c) => c.key === "needs-dispatch");
  assert.ok(needs);
  assert.equal(needs?.count, 1);
  const blocked = summary.counts.find((c) => c.key === "blocked-agent");
  assert.equal(blocked?.count, 1);
  const ready = summary.counts.find((c) => c.key === "ready-for-cleanup");
  assert.equal(ready?.count, 1);
});

test("unitById finds a unit", () => {
  assert.equal(unitById(fixtureSnapshot(), "T3-review")?.id, "T3-review");
  assert.equal(unitById(fixtureSnapshot(), "nope"), undefined);
});

test("formatAge is deterministic with an explicit now", () => {
  const now = Date.now();
  assert.equal(formatAge(new Date(now - 30_000).toISOString(), now), "30s ago");
  assert.equal(formatAge(new Date(now - 90_000).toISOString(), now), "1m ago");
  assert.equal(formatAge(new Date(now - 3_600_000).toISOString(), now), "1h ago");
  assert.equal(formatAge("not-a-date", now), "unknown");
});

test("formatElapsed buckets durations", () => {
  assert.equal(formatElapsed(undefined), "—");
  assert.equal(formatElapsed(5_000), "5s");
  assert.equal(formatElapsed(65_000), "1m");
  assert.equal(formatElapsed(3_700_000), "1h 1m");
});

test("showBranch strips an origin/ prefix", () => {
  assert.equal(showBranch("origin/factory/t9"), "factory/t9");
  assert.equal(showBranch("factory/t9"), "factory/t9");
});
