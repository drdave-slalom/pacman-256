import assert from "node:assert/strict";
import { test } from "node:test";
import type { Unit } from "@maze/factory-control-shared";
import { fixtureSnapshot } from "./fixtures.ts";
import { buildActionMenu, candidateActions, type PreparedOutcome } from "./actions.ts";

function unitOf(id: string): Unit {
  const unit = fixtureSnapshot().units.find((u) => u.id === id);
  assert.ok(unit, `fixture unit ${id}`);
  return unit;
}

test("candidateActions for an issue-seeded unit exposes the four new actions", () => {
  const snapshot = fixtureSnapshot();
  const actions = candidateActions(unitOf("I16-issue"), snapshot);
  assert.deepEqual(
    actions.map((a) => a.name),
    ["github/issue-comment", "github/issue-label", "github/issue-state", "factory/start-work"],
  );
  assert.deepEqual(
    actions.map((a) => a.form),
    ["comment", "labels", "state", undefined],
  );
});

test("candidateActions for a hybrid unit exposes the issue actions too", () => {
  const snapshot = fixtureSnapshot();
  const names = candidateActions(unitOf("T17-hybrid"), snapshot).map((a) => a.name);
  assert.ok(names.includes("github/issue-comment"));
  assert.ok(names.includes("github/issue-label"));
  assert.ok(names.includes("github/issue-state"));
  assert.ok(names.includes("factory/start-work"));
});

test("candidateActions omits start-work when the issue already has a worktree", () => {
  const snapshot = fixtureSnapshot();
  const unit: Unit = {
    ...unitOf("I16-issue"),
    worktree: { path: "/tmp/wt-fc-i16", dirty: false },
  };
  const names = candidateActions(unit, snapshot).map((a) => a.name);
  assert.ok(!names.includes("factory/start-work"));
  assert.equal(names.length, 3);
});

test("candidateActions omits start-work when a branch already exists for the unit", () => {
  const snapshot = fixtureSnapshot();
  snapshot.orphaned.branches.push("origin/factory/i16-issue");
  const names = candidateActions(unitOf("I16-issue"), snapshot).map((a) => a.name);
  assert.ok(!names.includes("factory/start-work"));
});

test("candidateActions returns nothing for a spec-only unit", () => {
  const snapshot = fixtureSnapshot();
  assert.deepEqual(candidateActions(unitOf("T15-parse"), snapshot), []);
});

test("buildActionMenu maps prepare outcomes to ok/reasons", () => {
  const snapshot = fixtureSnapshot();
  const candidates = candidateActions(unitOf("I16-issue"), snapshot);
  const prepared = new Map<string, PreparedOutcome>([
    [
      "github/issue-comment",
      {
        ok: false,
        preconditions: [
          { name: "gh-auth", ok: false, detail: "gh not authenticated" },
          { name: "issue-open", ok: true, detail: "issue #16 is open" },
        ],
      },
    ],
    [
      "github/issue-label",
      {
        ok: true,
        preconditions: [{ name: "gh-auth", ok: true, detail: "gh authenticated" }],
        plan: { summary: "Add labels to #16", steps: [{ command: "gh", args: ["issue", "edit", "16", "--add-label", "bug"] }] },
        requestId: "req-1",
      },
    ],
  ]);
  const rows = buildActionMenu(candidates, prepared);

  const comment = rows.find((r) => r.name === "github/issue-comment");
  assert.ok(comment);
  assert.equal(comment?.ok, false);
  assert.equal(comment?.form, "comment");
  assert.deepEqual(comment?.reasons, ["gh-auth: gh not authenticated"]);

  const label = rows.find((r) => r.name === "github/issue-label");
  assert.ok(label);
  assert.equal(label?.ok, true);
  assert.equal(label?.requestId, "req-1");
  assert.equal(label?.plan?.summary, "Add labels to #16");
  assert.equal(label?.plan?.steps[0]?.command, "gh");
  assert.deepEqual(label?.reasons, []);

  const start = rows.find((r) => r.name === "factory/start-work");
  assert.ok(start);
  assert.equal(start?.ok, false);
  assert.deepEqual(start?.reasons, ["not prepared"]);
  assert.equal(start?.form, undefined);
});

test("buildActionMenu surfaces a failed execute (409) guard reason", () => {
  const candidates = candidateActions(unitOf("T17-hybrid"), fixtureSnapshot());
  const prepared = new Map<string, PreparedOutcome>([
    [
      "github/issue-state",
      {
        ok: false,
        preconditions: [
          { name: "issue-lock", ok: false, detail: "a different request holds the unit lock" },
        ],
      },
    ],
  ]);
  const rows = buildActionMenu(candidates, prepared);
  const stateRow = rows.find((r) => r.name === "github/issue-state");
  assert.ok(stateRow);
  assert.equal(stateRow?.ok, false);
  assert.deepEqual(stateRow?.reasons, ["issue-lock: a different request holds the unit lock"]);
});
