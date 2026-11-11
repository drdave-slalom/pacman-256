import test from "node:test";
import assert from "node:assert/strict";
import { fixtureSnapshot } from "./fixtures.ts";
import { candidateTriggers } from "./triggers.ts";

function unitOf(id: string) {
  const unit = fixtureSnapshot().units.find((u) => u.id === id);
  assert.ok(unit, `fixture unit ${id}`);
  return unit;
}

test("candidateTriggers offers dispatch on a Spec-stage unit with no writer", () => {
  const snapshot = fixtureSnapshot();
  const triggers = candidateTriggers(unitOf("T1-spec"), snapshot);
  assert.deepEqual(triggers.map((t) => t.kind), ["dispatch"]);
  assert.equal(triggers[0]?.name, "dispatch");
  assert.equal(triggers[0]?.label, "Dispatch unit");
});

test("candidateTriggers offers open-pr on an executing unit with a branch and no PR", () => {
  const snapshot = fixtureSnapshot();
  const triggers = candidateTriggers(unitOf("T2-execute"), snapshot);
  const names = triggers.map((t) => t.name);
  assert.ok(names.includes("skill:open-pr"));
  assert.ok(!names.includes("dispatch"));
  assert.ok(!names.includes("skill:qa-tester"));
  assert.ok(!names.includes("skill:pr-reviewer"));
});

test("candidateTriggers offers pr-reviewer on a review unit; no open-pr when PR exists", () => {
  const snapshot = fixtureSnapshot();
  const triggers = candidateTriggers(unitOf("T3-review"), snapshot);
  const names = triggers.map((t) => t.name);
  assert.ok(names.includes("skill:pr-reviewer"));
  assert.ok(!names.includes("skill:open-pr"));
  assert.ok(!names.includes("skill:qa-tester"));
});

test("candidateTriggers offers qa-tester on a qa-stage unit (flag)", () => {
  const snapshot = fixtureSnapshot();
  const unit = {
    ...unitOf("T2-execute"),
    id: "T5-qa",
    stage: "qa" as const,
    flags: { ...unitOf("T2-execute").flags, qaPending: true },
  };
  const triggers = candidateTriggers(unit, snapshot);
  const names = triggers.map((t) => t.name);
  assert.ok(names.includes("skill:qa-tester"));
  assert.ok(names.includes("skill:open-pr"), "branch exists and no PR → open-pr still offered");
});

test("candidateTriggers returns nothing for a terminal merged unit", () => {
  const snapshot = fixtureSnapshot();
  const triggers = candidateTriggers(unitOf("T4-merged"), snapshot);
  assert.equal(triggers.length, 0);
});
