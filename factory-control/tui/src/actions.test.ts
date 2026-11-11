import test from "node:test";
import assert from "node:assert/strict";
import { fixtureSnapshot, fixtureSnapshotWithIssues, standaloneIssueUnit } from "./fixtures.ts";
import { buildActionMenu, candidateActions, type PreparedOutcome } from "./actions.ts";

function unitOf(id: string) {
  const unit = fixtureSnapshot().units.find((u) => u.id === id);
  assert.ok(unit, `fixture unit ${id}`);
  return unit;
}

test("candidateActions for a spec-stage unit suggests only worktree/create", () => {
  const snapshot = fixtureSnapshot();
  const actions = candidateActions(unitOf("T1-spec"), snapshot);
  assert.deepEqual(actions.map((a) => a.name), ["worktree/create"]);
});

test("candidateActions for an executing unit suggests checks/remove/pr-open", () => {
  const snapshot = fixtureSnapshot();
  const names = candidateActions(unitOf("T2-execute"), snapshot).map((a) => a.name);
  assert.ok(names.includes("worktree/remove"));
  assert.ok(names.includes("checks/run"));
  assert.ok(names.includes("pr/open"));
  assert.ok(!names.includes("pr/merge"));
  assert.ok(!names.includes("checks/query"));
});

test("candidateActions for a review unit with open PR suggests query/merge/main-merge", () => {
  const snapshot = fixtureSnapshot();
  const names = candidateActions(unitOf("T3-review"), snapshot).map((a) => a.name);
  for (const expected of ["worktree/remove", "checks/run", "checks/query", "pr/merge", "main/merge"]) {
    assert.ok(names.includes(expected), `expected ${expected} in ${names.join(",")}`);
  }
  assert.ok(!names.includes("pr/open"));
  assert.ok(!names.includes("worktree/create"));
});

test("candidateActions for a merged+cleanup unit suggests worktree/remove", () => {
  const snapshot = fixtureSnapshot();
  const names = candidateActions(unitOf("T4-merged"), snapshot).map((a) => a.name);
  assert.ok(names.includes("worktree/remove"));
});

test("candidateActions adds issue write-back + start-work actions on issue cards", () => {
  const snapshot = fixtureSnapshotWithIssues();
  const names = candidateActions(standaloneIssueUnit(), snapshot).map((a) => a.name);
  for (const expected of ["github/issue-comment", "github/issue-label", "github/issue-state", "factory/start-work"]) {
    assert.ok(names.includes(expected), `expected ${expected} in ${names.join(",")}`);
  }
});

test("candidateActions omits issue actions without an issue card", () => {
  const snapshot = fixtureSnapshot();
  const names = candidateActions(unitOf("T3-review"), snapshot).map((a) => a.name);
  assert.ok(!names.includes("github/issue-comment"));
  assert.ok(!names.includes("github/issue-label"));
  assert.ok(!names.includes("github/issue-state"));
  assert.ok(!names.includes("factory/start-work"));
});

test("buildActionMenu marks input rows openable without eager prepare", () => {
  const snapshot = fixtureSnapshotWithIssues();
  const candidates = candidateActions(standaloneIssueUnit(), snapshot);
  const rows = buildActionMenu(candidates, new Map());
  const comment = rows.find((r) => r.name === "github/issue-comment");
  assert.ok(comment);
  assert.equal(comment?.input, "comment");
  assert.equal(comment?.ok, true);
  assert.deepEqual(comment?.reasons, []);
  const labels = rows.find((r) => r.name === "github/issue-label");
  assert.equal(labels?.input, "labels");
  const state = rows.find((r) => r.name === "github/issue-state");
  assert.equal(state?.input, "state");
  const sw = rows.find((r) => r.name === "factory/start-work");
  assert.equal(sw?.input, undefined);
  assert.equal(sw?.ok, false); // no prepared outcome → needs prepare
  assert.deepEqual(sw?.reasons, ["not prepared"]);
});

test("buildActionMenu maps prepare outcomes to ok/reasons", () => {
  const snapshot = fixtureSnapshot();
  const candidates = candidateActions(unitOf("T3-review"), snapshot);
  const prepared = new Map<string, PreparedOutcome>([
    [
      "pr/merge",
      {
        ok: false,
        preconditions: [
          { name: "checks-green", ok: false, detail: "checks are red; expected green" },
          { name: "pr-open", ok: true, detail: "PR #3 is open" },
        ],
      },
    ],
    ["checks/query", { ok: true, preconditions: [{ name: "pr-exists", ok: true, detail: "PR exists" }] }],
  ]);
  const rows = buildActionMenu(candidates, prepared);
  const merge = rows.find((r) => r.name === "pr/merge");
  assert.ok(merge);
  assert.equal(merge?.ok, false);
  assert.deepEqual(merge?.reasons, ["checks-green: checks are red; expected green"]);
  const query = rows.find((r) => r.name === "checks/query");
  assert.equal(query?.ok, true);
  assert.deepEqual(query?.reasons, []);
  const unp = rows.find((r) => r.name === "main/merge");
  assert.equal(unp?.ok, false);
  assert.deepEqual(unp?.reasons, ["not prepared"]);
});
