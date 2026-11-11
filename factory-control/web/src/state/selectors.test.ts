import assert from "node:assert/strict";
import { test } from "node:test";
import type { Unit } from "@maze/factory-control-shared";
import {
  ATTENTION_META,
  BOARD_COLUMNS,
  LIFECYCLE_META,
  attentionBadges,
  buildBoard,
  formatAge,
  formatDiff,
  formatElapsed,
  showBranch,
  stageToColumn,
  suggestNextAction,
  summarize,
  totalOrphaned,
} from "./selectors.ts";
import { fixtureSnapshot } from "./fixtures.ts";

test("stageToColumn maps every shared stage to its column key", () => {
  assert.equal(stageToColumn("spec"), "spec");
  assert.equal(stageToColumn("execute"), "execute");
  assert.equal(stageToColumn("review"), "review");
  assert.equal(stageToColumn("qa"), "qa");
  assert.equal(stageToColumn("integrate"), "integrate");
  assert.equal(stageToColumn("ci"), "ci");
  assert.equal(stageToColumn("done"), "done");
  assert.equal(stageToColumn("unknown"), "unknown");
});

test("board columns follow Spec → … → Done then Unknown/Orphaned", () => {
  const keys = BOARD_COLUMNS.map((c) => c.key);
  assert.deepEqual(keys, ["spec", "dispatch", "execute", "review", "qa", "integrate", "ci", "done"]);
});

test("buildBoard places every unit in its inferred column and keeps orphans", () => {
  const board = buildBoard(fixtureSnapshot());
  const byKey = new Map(board.columns.map((c) => [c.key, c.units]));
  assert.deepEqual(byKey.get("execute")?.map((u) => u.id), ["T10-execute"]);
  assert.deepEqual(byKey.get("review")?.map((u) => u.id), ["T11-review"]);
  assert.deepEqual(byKey.get("integrate")?.map((u) => u.id), ["T12-integrate"]);
  assert.deepEqual(byKey.get("done")?.map((u) => u.id), ["T14-done"]);
  assert.deepEqual(byKey.get("spec")?.map((u) => u.id), ["T15-parse"]);
  assert.deepEqual(byKey.get("unknown")?.map((u) => u.id), ["T13-unknown"]);
  assert.equal(board.columns.reduce((n, c) => n + c.units.length, 0), 6);
  assert.equal(totalOrphaned(board), 4);
});

test("attentionBadges maps attention keys to labels and tones", () => {
  assert.equal(ATTENTION_META["blocked-agent"].tone, "danger");
  assert.equal(ATTENTION_META["review-pending"].label, "Review pending");
  assert.equal(ATTENTION_META["ready-to-merge"].tone, "success");
  const badges = attentionBadges(["ci-red", "review-pending"]);
  assert.deepEqual(
    badges.map((b) => b.key),
    ["ci-red", "review-pending"],
  );
  assert.equal(badges[0]?.tone, "danger");
});

test("lifecycle glyphs exist for every lifecycle state", () => {
  for (const state of ["working", "blocked", "settling", "starting", "idle", "done", "unknown", "lost"] as const) {
    assert.ok(LIFECYCLE_META[state], `missing meta for ${state}`);
  }
});

test("formatElapsed renders compact durations", () => {
  assert.equal(formatElapsed(undefined), "—");
  assert.equal(formatElapsed(5_000), "5s");
  assert.equal(formatElapsed(150_000), "2m");
  assert.equal(formatElapsed(3_700_000), "1h 1m");
});

test("formatDiff renders +add −del", () => {
  assert.equal(formatDiff(undefined), "");
  assert.equal(formatDiff({ add: 42, del: 7, files: 5 }), "+42 −7");
});

test("showBranch strips remote prefix", () => {
  assert.equal(showBranch("origin/factory/t10-execute"), "factory/t10-execute");
  assert.equal(showBranch("factory/t10-execute"), "factory/t10-execute");
});

test("formatAge is finite and labelled", () => {
  const recent = formatAge(new Date().toISOString());
  assert.match(recent, /ago$/);
  assert.equal(formatAge("not-a-date"), "unknown");
});

test("summarize counts units, agents, and attention", () => {
  const s = summarize(fixtureSnapshot());
  assert.equal(s.units, 6);
  assert.equal(s.agents, 6);
  assert.equal(s.working, 1);
  assert.equal(s.blocked, 1);
  assert.equal(s.acting, 3); // working + blocked + starting
  assert.equal(s.attention, 5);
  assert.equal(s.errors, 0);
});

test("suggestNextAction is derived from flags/attention and display-only", () => {
  const snap = fixtureSnapshot();
  const review = snap.units.find((u) => u.id === "T11-review");
  assert.ok(review);
  assert.equal(suggestNextAction(review).label, "Assign PR review");

  const needsDispatch: Unit = {
    id: "T99-dispatch",
    stage: "spec",
    flags: { reviewPending: false, qaPending: false, ciRed: false, readyToMerge: false, readyForCleanup: false, needsDispatch: true, blockedAgent: false },
    agents: [],
    handoffs: [],
    attention: ["needs-dispatch"],
  };
  assert.equal(suggestNextAction(needsDispatch).label, "Dispatch unit");
  const merge = snap.units.find((u) => u.id === "T12-integrate");
  assert.ok(merge);
  assert.equal(suggestNextAction(merge).label, "Approve & merge");
  const cleanup = snap.units.find((u) => u.id === "T14-done");
  assert.ok(cleanup);
  assert.equal(suggestNextAction(cleanup).label, "Remove worktree");
  const unknown = snap.units.find((u) => u.id === "T13-unknown");
  assert.ok(unknown);
  assert.equal(suggestNextAction(unknown).label, "Reconcile unit");
});

test("suggestNextAction surfaces parse-error before the spec fallthrough", () => {
  const snap = fixtureSnapshot();
  const parse = snap.units.find((u) => u.id === "T15-parse");
  assert.ok(parse);
  const action = suggestNextAction(parse);
  assert.equal(action.label, "Fix spec parse error");
  assert.match(action.note, /controller TUI/);
});
