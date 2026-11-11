import test from "node:test";
import assert from "node:assert/strict";
import { fixtureSnapshot } from "./fixtures.ts";
import { buildBoard, flattenUnits } from "./selectors.ts";
import {
  plainStyle,
  renderActionMenu,
  renderActionPlan,
  renderActionResult,
  renderAgentsView,
  renderBoardBody,
  renderDetail,
  renderHeader,
  renderOfflineBanner,
} from "./render.ts";
import { visibleWidth } from "./width.ts";

function assertLinesFit(lines: string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `line exceeds ${width}: ${JSON.stringify(line)}`);
  }
}

test("renderHeader shows branch, age and attention counts", () => {
  const lines = renderHeader(fixtureSnapshot(), plainStyle, 80);
  const joined = lines.join("\n");
  assert.ok(joined.includes("main"));
  assert.ok(joined.includes("attn 4"));
  assertLinesFit(lines, 80);
});

test("renderOfflineBanner shows retry/start hints", () => {
  const lines = renderOfflineBanner({ retrying: false, serverStarted: false, error: "ECONNREFUSED" }, plainStyle, 80);
  const joined = lines.join("\n");
  assert.ok(joined.includes("control server unreachable"));
  assert.ok(joined.includes("[r] retry"));
  assert.ok(joined.includes("[s] start server"));
  assertLinesFit(lines, 80);
});

test("renderBoardBody renders columns, cards, badges and dirty marker", () => {
  const model = buildBoard(fixtureSnapshot());
  const lines = renderBoardBody(model, 1, plainStyle, 100);
  const joined = lines.join("\n");
  for (const title of ["Spec", "Execute", "Review", "Done", "Unknown", "Orphaned"]) {
    assert.ok(joined.includes(title), `missing column ${title}`);
  }
  for (const id of ["T1-spec", "T2-execute", "T3-review", "T4-merged"]) {
    assert.ok(joined.includes(id), `missing unit ${id}`);
  }
  // badge glyphs
  assert.ok(joined.includes("[D]"), "expected needs-dispatch badge");
  assert.ok(joined.includes("[B]"), "expected blocked-agent badge");
  assert.ok(joined.includes("[R]"), "expected review-pending badge");
  assert.ok(joined.includes("[C]"), "expected ready-for-cleanup badge");
  // dirty marker for T2 worktree
  const t2Line = lines.find((l) => l.includes("T2-execute"));
  assert.ok(t2Line?.includes(" *"));
  assertLinesFit(lines, 100);
});

test("renderDetail shows spec/git/pr/trail/next-action", () => {
  const snapshot = fixtureSnapshot();
  const unit = flattenUnits(buildBoard(snapshot)).find((u) => u.id === "T3-review");
  assert.ok(unit);
  const lines = renderDetail(unit, snapshot, plainStyle, 120);
  const joined = lines.join("\n");
  assert.ok(joined.includes("T3-review"));
  assert.ok(joined.includes("SPEC/T3-review.md"));
  assert.ok(joined.includes("factory/t3-review"));
  assert.ok(joined.includes("#3"));
  assert.ok(joined.includes("OPEN"));
  assert.ok(joined.includes("pr-reviewer"));
  assert.ok(joined.includes("Assign PR review"));
  assertLinesFit(lines, 120);
});

test("renderAgentsView lists agent rows with lifecycle glyphs", () => {
  const snapshot = fixtureSnapshot();
  const lines = renderAgentsView(snapshot.agents, 0, plainStyle, 100);
  const joined = lines.join("\n");
  assert.ok(joined.includes("builder-t2"));
  assert.ok(joined.includes("idle-x"));
  assert.ok(joined.includes("*"));
  assert.ok(joined.includes("ctx 40%"));
  assert.ok(joined.includes("open owning unit detail"));
  assertLinesFit(lines, 100);
});

test("renderActionMenu shows ok/rejected rows with reasons", () => {
  const rows = [
    {
      name: "checks/query",
      label: "Query PR checks",
      hint: "poll gh pr checks",
      ok: true,
      reasons: [],
      preconditions: [],
    },
    {
      name: "pr/merge",
      label: "Merge PR",
      hint: "gh pr merge --merge",
      ok: false,
      reasons: ["qa-handoff: QA handoff missing (qa-tester)"],
      preconditions: [
        { name: "qa-handoff", ok: false, detail: "QA handoff missing (qa-tester)" },
      ],
    },
  ];
  const lines = renderActionMenu(rows, 1, plainStyle, 100);
  const joined = lines.join("\n");
  assert.ok(joined.includes("Query PR checks"));
  assert.ok(joined.includes("Merge PR"));
  assert.ok(joined.includes("QA handoff missing (qa-tester)"));
  assertLinesFit(lines, 100);
});

test("renderActionPlan lists preconditions and steps", () => {
  const row = {
    name: "pr/merge",
    label: "Merge PR",
    hint: "gh pr merge --merge",
    ok: true,
    reasons: [],
    preconditions: [
      { name: "checks-green", ok: true, detail: "checks green" },
      { name: "review-handoff", ok: true, detail: "review handoff present (pr-reviewer)" },
    ],
    plan: {
      summary: "Merge PR #3 (factory/t3-review) with --merge",
      steps: [{ command: "gh", args: ["pr", "merge", "3", "--merge"] }],
    },
  };
  const lines = renderActionPlan(row, plainStyle, 120);
  const joined = lines.join("\n");
  assert.ok(joined.includes("Merge PR #3 (factory/t3-review) with --merge"));
  assert.ok(joined.includes("gh pr merge 3 --merge"));
  assert.ok(joined.includes("checks-green"));
  assertLinesFit(lines, 120);
});

test("renderActionResult renders 409 precondition reasons", () => {
  const lines = renderActionResult(
    {
      kind: "error",
      message: "preconditions failed",
      preconditions: [
        { name: "qa-handoff", ok: false, detail: "QA handoff missing (qa-tester)" },
        { name: "checks-green", ok: true, detail: "checks green" },
      ],
    },
    plainStyle,
    120,
  );
  const joined = lines.join("\n");
  assert.ok(joined.includes("rejected"));
  assert.ok(joined.includes("qa-handoff"));
  assert.ok(joined.includes("QA handoff missing (qa-tester)"));
  assertLinesFit(lines, 120);
});

test("renderActionResult renders success output tail", () => {
  const lines = renderActionResult(
    {
      kind: "ok",
      outcome: {
        outcome: "success",
        command: ["npm run check"],
        exit: 0,
        outputTail: "all checks passed\n",
      },
    },
    plainStyle,
    100,
  );
  const joined = lines.join("\n");
  assert.ok(joined.includes("success"));
  assert.ok(joined.includes("all checks passed"));
  assertLinesFit(lines, 100);
});
