import test from "node:test";
import assert from "node:assert/strict";
import type { Unit } from "@maze/factory-control-shared";
import { fixtureSnapshot, fixtureSnapshotWithClosedIssues, fixtureSnapshotWithIssues } from "./fixtures.ts";
import { buildBoard, closedUnmatchedIssues, flattenUnits } from "./selectors.ts";
import {
  plainStyle,
  renderActionMenu,
  type LineStyle,

  renderActionPlan,
  renderActionResult,
  renderAgentsView,
  renderBoardBody,
  renderClosedIssues,
  renderDetail,
  renderHeader,
  renderHelp,
  renderOfflineBanner,
  renderPipelineStrip,
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

test("renderHelp has no closed-issues toggle hint", () => {
  const lines = renderHelp("board", plainStyle, 100);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("i closed"), `no toggle hint expected, got:\n${joined}`);
  assert.ok(joined.includes("esc close"), `expected close hint, got:\n${joined}`);
});

test("renderOfflineBanner shows retry/start hints", () => {
  const lines = renderOfflineBanner({ retrying: false, serverStarted: false, error: "ECONNREFUSED" }, plainStyle, 80);
  const joined = lines.join("\n");
  assert.ok(joined.includes("control server unreachable"));
  assert.ok(joined.includes("[r] retry"));
  assert.ok(joined.includes("[s] start server"));
  assertLinesFit(lines, 80);
});

const FIXTURE_STRIP = [
  "┌──────┐ → ┌──────────┐ → ┌─────────┐ → ┌────────┐ → ┌─────┐ → ┌───────────┐ → ┌─────┐ → ┌──────┐",
  "│ Spec │ → │ Dispatch │ → │ Execute │ → │ Review │ → │ QA  │ → │ Integrate │ → │ CI  │ → │ Done │",
  "│ (1)  │ → │   (0)    │ → │   (1)   │ → │  (1)   │ → │ (0) │ → │    (0)    │ → │ (0) │ → │ (1)  │",
  "└──────┘ → └──────────┘ → └─────────┘ → └────────┘ → └─────┘ → └───────────┘ → └─────┘ → └──────┘",
];
// A LineStyle that injects ANSI SGR prefixes the way the theme-backed screen
// style does. This forces the wrap logic to measure display width, not byte
// length (regression test for the plainStyle-hidden wrap bug).
const ANSI_STYLE: LineStyle = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  muted: (s) => `\u001b[2m${s}\u001b[0m`,
  accent: (s) => `\u001b[36m${s}\u001b[0m`,
  warn: (s) => `\u001b[33m${s}\u001b[0m`,
  success: (s) => `\u001b[32m${s}\u001b[0m`,
  error: (s) => `\u001b[31m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
};

function stripAnsi(text: string): string {
  return text.replace(/\u001b[[0-9;]*m/g, "");
}

function boxesOnRow(line: string): number {
  return (line.match(/┌/g) ?? []).length;
}

test("renderPipelineStrip renders the eight stages in order with live counts", () => {
  const model = buildBoard(fixtureSnapshot());
  const lines = renderPipelineStrip(model, plainStyle, 100);
  assert.deepEqual(lines, FIXTURE_STRIP);
  assertLinesFit(lines, 100);
});

test("renderPipelineStrip wraps onto further rows on a narrow width", () => {
  const model = buildBoard(fixtureSnapshot());
  const lines = renderPipelineStrip(model, plainStyle, 80);
  assert.deepEqual(lines, [
    "┌──────┐ → ┌──────────┐ → ┌─────────┐ → ┌────────┐ → ┌─────┐ → ┌───────────┐",
    "│ Spec │ → │ Dispatch │ → │ Execute │ → │ Review │ → │ QA  │ → │ Integrate │",
    "│ (1)  │ → │   (0)    │ → │   (1)   │ → │  (1)   │ → │ (0) │ → │    (0)    │",
    "└──────┘ → └──────────┘ → └─────────┘ → └────────┘ → └─────┘ → └───────────┘",
    "┌─────┐ → ┌──────┐",
    "│ CI  │ → │ Done │",
    "│ (0) │ → │ (1)  │",
    "└─────┘ → └──────┘",
  ]);
  assertLinesFit(lines, 80);
});

test("renderPipelineStrip lays out by visible width under an ANSI-styled theme", () => {
  const model = buildBoard(fixtureSnapshot());
  // Width 100 fits all eight boxes on a single row (AC#2 under real styling).
  const wide = renderPipelineStrip(model, ANSI_STYLE, 100);
  assert.equal(wide.length, 4);
  assert.equal(boxesOnRow(wide[0]!), 8);
  for (const line of wide) {
    assert.ok(visibleWidth(stripAnsi(line)) <= 100, `line exceeds 100: ${JSON.stringify(line)}`);
  }
  // Width 80 wraps to two rows (6 + 2); every line still fits.
  const narrow = renderPipelineStrip(model, ANSI_STYLE, 80);
  assert.equal(narrow.length, 8);
  assert.deepEqual(narrow.filter((l) => l.includes("┌")).map(boxesOnRow), [6, 2]);
  for (const line of narrow) {
    assert.ok(visibleWidth(stripAnsi(line)) <= 80, `line exceeds 80: ${JSON.stringify(line)}`);
  }
});
test("renderPipelineStrip shows a single dim no-units line for an empty board", () => {
  const model = buildBoard(fixtureSnapshot({ units: [] }));
  assert.deepEqual(renderPipelineStrip(model, plainStyle, 100), ["no units"]);
});

test("renderPipelineStrip excludes Unknown/Orphaned stages", () => {
  const unknownUnit: Unit = {
    id: "U-unknown",
    kind: "spec",
    stage: "unknown",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: false,
      blockedAgent: false,
    },
    agents: [],
    handoffs: [],
    attention: [],
  };
  const model = buildBoard(
    fixtureSnapshot({
      units: [...fixtureSnapshot().units, unknownUnit],
      orphaned: {
        branches: ["origin/factory/orphan1"],
        worktrees: ["/tmp/wt-orphan"],
        prs: [
          { number: 99, title: "P", state: "OPEN", headRefName: "factory/t99", url: "u", checks: "green" },
        ],
        handoffs: [{ agent: "lead", source: "result" }],
      },
    }),
  );
  const lines = renderPipelineStrip(model, plainStyle, 100);
  const joined = lines.join("\n");
  assert.ok(!joined.includes("Unknown"));
  assert.ok(!joined.includes("Orphaned"));
  assert.ok(!joined.includes("U-unknown"));
  assert.ok(!joined.includes("branch"));
  assert.ok(!joined.includes("worktree"));
  assert.ok(!joined.includes("handoff"));
  // stage counts are unchanged by the unknown unit / orphaned bucket → exact strip
  assert.deepEqual(lines, FIXTURE_STRIP);
});

test("renderBoardBody renders columns, cards, badges and dirty marker", () => {
  const model = buildBoard(fixtureSnapshot());
  const lines = renderBoardBody(model, 1, plainStyle, 100, []);
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

test("renderBoardBody shows issue cards as #n + title + status", () => {
  const model = buildBoard(fixtureSnapshotWithIssues());
  const lines = renderBoardBody(model, 0, plainStyle, 120, []);
  const joined = lines.join("\n");
  assert.ok(joined.includes("#12 Mobile touch controls feel laggy [ready] [GitHub]"));
  assert.ok(joined.includes("#7 Add sound effects [review] [GitHub]"));
  assertLinesFit(lines, 120);
});

test("renderClosedIssues renders the section header and dim rows", () => {
  const closed = closedUnmatchedIssues(fixtureSnapshotWithClosedIssues());
  const lines = renderClosedIssues(closed, plainStyle, 200);
  assert.deepEqual(lines, [
    "Closed issues (2)",
    "  #53 Closed issue without a unit [done]",
    "  #60 Another closed orphan issue [closed]",
  ]);
});

test("renderClosedIssues is hidden when the list is empty", () => {
  assert.deepEqual(renderClosedIssues([], plainStyle, 200), []);
});

test("renderBoardBody always appends the Closed issues section after Orphaned", () => {
  const snapshot = fixtureSnapshotWithClosedIssues();
  const model = buildBoard(snapshot);
  const lines = renderBoardBody(model, 0, plainStyle, 200, closedUnmatchedIssues(snapshot));
  const joined = lines.join("\n");
  assert.ok(joined.includes("Orphaned (2)"), `expected Orphaned section, got:\n${joined}`);
  assert.ok(joined.includes("Closed issues (2)"), `expected Closed issues section, got:\n${joined}`);
  assert.ok(joined.includes("  #53 Closed issue without a unit [done]"), `got:\n${joined}`);
  assert.ok(joined.includes("  #60 Another closed orphan issue [closed]"), `got:\n${joined}`);
  // section order: columns → Orphaned → Closed issues
  assert.ok(joined.indexOf("Orphaned (2)") < joined.indexOf("Closed issues (2)"));
  assertLinesFit(lines, 200);
});

test("renderBoardBody hides the Closed issues section when empty", () => {
  const snapshot = fixtureSnapshotWithClosedIssues();
  const model = buildBoard(snapshot);
  const empty = renderBoardBody(model, 0, plainStyle, 200, []);
  assert.ok(!empty.join("\n").includes("Closed issues"));
});

test("renderBoardBody shows [GitHub] badge on issue-seeded and hybrid cards, none on spec-only", () => {
  const model = buildBoard(fixtureSnapshotWithIssues());
  const lines = renderBoardBody(model, 0, plainStyle, 120, []);
  // issue-seeded (standalone) card carries the badge
  const issueLine = lines.find((l) => l.includes("#12"));
  assert.ok(issueLine !== undefined, "missing issue-seeded card line");
  assert.ok(issueLine.includes("[GitHub]"), `issue-seeded card must show [GitHub], got: ${issueLine}`);
  // hybrid card carries the badge
  const hybridLine = lines.find((l) => l.includes("#7"));
  assert.ok(hybridLine !== undefined, "missing hybrid card line");
  assert.ok(hybridLine.includes("[GitHub]"), `hybrid card must show [GitHub], got: ${hybridLine}`);
  // spec-only cards show no badge
  for (const id of ["T1-spec", "T2-execute", "T4-merged"]) {
    const specLine = lines.find((l) => l.includes(id));
    assert.ok(specLine !== undefined, `missing spec-only card line ${id}`);
    assert.ok(!specLine.includes("[GitHub]"), `spec-only card ${id} must not show [GitHub], got: ${specLine}`);
  }
  assertLinesFit(lines, 120);
});

test("renderDetail shows issue fields and the GitHub URL", () => {
  const snapshot = fixtureSnapshotWithIssues();
  const unit = flattenUnits(buildBoard(snapshot)).find((u) => u.id === "issue12");
  assert.ok(unit);
  const lines = renderDetail(unit!, snapshot, plainStyle, 140);
  const joined = lines.join("\n");
  assert.ok(joined.includes("issue"));
  assert.ok(joined.includes("#12"));
  assert.ok(joined.includes("state open"));
  assert.ok(joined.includes("status ready"));
  assert.ok(joined.includes("type:bug"));
  assert.ok(joined.includes("lane:B"));
  assert.ok(joined.includes("role:builder+qa"));
  assert.ok(joined.includes("playtest"));
  assert.ok(joined.includes("assignees alice"));
  assert.ok(joined.includes("milestone MVP"));
  assert.ok(joined.includes("https://github.com/example/repo/issues/12"));
  assert.ok(joined.includes("Touch joystick input"));
  assertLinesFit(lines, 140);
});

test("renderDetail shows issue field on hybrid cards alongside spec/git", () => {
  const snapshot = fixtureSnapshotWithIssues();
  const unit = flattenUnits(buildBoard(snapshot)).find((u) => u.id === "T3-review");
  assert.ok(unit);
  const lines = renderDetail(unit!, snapshot, plainStyle, 140);
  const joined = lines.join("\n");
  assert.ok(joined.includes("#7 Add sound effects"));
  assert.ok(joined.includes("SPEC/T3-review.md"));
  assert.ok(joined.includes("factory/t3-review"));
  assertLinesFit(lines, 140);
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
