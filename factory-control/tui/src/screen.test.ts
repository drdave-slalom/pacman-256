/**
 * Interactive-screen regression tests (B1 cache-invalidation, S1 preparing
 * state / stale-guard, N4 agent-without-owner feedback, keyboard scroll edge).
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { DispatchPrepareResponse, PrepareResponse } from "./api.ts";
import { fixtureSnapshot, fixtureSnapshotForScrollEdge } from "./fixtures.ts";
import { FactoryScreen } from "./screen.ts";

const UP = "\u001b[A";
const DOWN = "\u001b[B";
const PGUP = "\u001b[5~";
const PGDN = "\u001b[6~";
const ENTER = "\r";
const ESC = "\u001b";
const W = 120;

interface HarnessOptions {
  fetch?: () => Promise<FactorySnapshot>;
  prepare?: (name: string, body: Record<string, unknown>) => Promise<PrepareResponse>;
  dispatchPrepare?: (body: { unit: string; skill?: string }) => Promise<DispatchPrepareResponse>;
}

function makeHarness(opts: HarnessOptions = {}) {
  const notifies: string[] = [];
  let doneCalls = 0;
  const ctx = {
    cwd: "/repo/primary",
    ui: {
      setWidget: () => {},
      notify: (msg: string) => {
        notifies.push(msg);
      },
      confirm: async () => true,
    },
    sessionManager: { getSessionName: () => "tester" },
  } as unknown as ExtensionContext;
  const tui = { requestRender: () => {}, terminal: { rows: 40 } } as unknown as TUI;
  const theme: Theme = { fg: (_t: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
  const screen = new FactoryScreen({
    tui,
    theme,
    kb: {
      matches: (data, binding) =>
        (binding === "tui.select.up" && data === UP) ||
        (binding === "tui.select.down" && data === DOWN) ||
        (binding === "tui.select.pageUp" && data === PGUP) ||
        (binding === "tui.select.pageDown" && data === PGDN) ||
        (binding === "tui.select.confirm" && data === ENTER) ||
        (binding === "tui.select.cancel" && data === ESC),
    },
    done: () => {
      doneCalls += 1;
    },
    ctx,
    query: "",
    fetchSnapshotImpl: opts.fetch ?? (() => Promise.resolve(fixtureSnapshot())),
    ...(opts.prepare !== undefined ? { prepareActionImpl: opts.prepare } : {}),
    dispatchPrepareImpl:
      opts.dispatchPrepare ??
      (() =>
        Promise.resolve({
          requestId: "rid",
          entryId: "req-x",
          ok: true,
          preconditions: [],
          plan: {
            kind: "dispatch",
            unit: "T3-review",
            role: "builder",
            worktree: "factory/t3-review",
            specPath: "SPEC/T3-review.md",
            acceptance: "a",
            summary: "s",
            delegationPrompt: "p",
          },
        })),
  });
  return { screen, notifies, doneCalls };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 15));
}

/** Resolve prepare promises as they appear (each await enqueues the next). */
async function drain(resolvers: Array<(r: PrepareResponse) => void>, ok = true): Promise<void> {
  for (let guard = 0; guard < 200; guard++) {
    const batch = resolvers.splice(0);
    if (batch.length === 0) break;
    for (const res of batch) {
      if (ok) res({ requestId: "rid", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } });
      else res({ requestId: "rid", ok: false, preconditions: [], plan: { summary: "plan", steps: [] } });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("render(width) reflects state changes without a width change (B1)", async (t) => {
  const h = makeHarness();
  t.after(() => h.screen.dispose());
  await settle();
  const first = h.screen.render(W);
  // Unchanged state: same width produces identical lines.
  assert.deepEqual(h.screen.render(W), first);
  // Mutate state (move board selection) at the same width.
  h.screen.handleInput(DOWN);
  const second = h.screen.render(W);
  assert.notDeepEqual(second, first, "board selection change must re-render at the same width");
  h.screen.handleInput(DOWN);
  const third = h.screen.render(W);
  assert.notDeepEqual(third, second);
});

test("board view renders the pipeline flow strip above the card columns", async (t) => {
  const h = makeHarness();
  t.after(() => h.screen.dispose());
  await settle();
  const joined = h.screen.render(W).join("\n");
  const stripTop = joined.indexOf("┌──────┐ → ┌──────────┐");
  assert.ok(stripTop >= 0, "expected boxed strip top border");
  assert.ok(joined.includes("│ Spec │ → │ Dispatch │"), "expected strip titles");
  const firstColumn = joined.indexOf("Spec (1)");
  assert.ok(firstColumn >= 0, "expected column header below the strip");
  assert.ok(stripTop < firstColumn, "strip must render above the columns");
  assert.ok(!joined.includes("Unknown (0)") || joined.indexOf("Unknown (0)") > stripTop, "Unknown column stays below the strip");
});


test("board pipeline strip stays fixed across selection moves", async (t) => {
  const h = makeHarness();
  t.after(() => h.screen.dispose());
  await settle();
  const before = h.screen.render(W);
  h.screen.handleInput(DOWN);
  const after = h.screen.render(W);
  // board view: [header, rule, strip(4), …body]; body/selection shift below.
  assert.deepEqual(before.slice(2, 6), [
  "┌──────┐ → ┌──────────┐ → ┌─────────┐ → ┌────────┐ → ┌─────┐ → ┌───────────┐ → ┌─────┐ → ┌──────┐",
  "│ Spec │ → │ Dispatch │ → │ Execute │ → │ Review │ → │ QA  │ → │ Integrate │ → │ CI  │ → │ Done │",
  "│ (1)  │ → │   (0)    │ → │   (1)   │ → │  (1)   │ → │ (0) │ → │    (0)    │ → │ (0) │ → │ (1)  │",
  "└──────┘ → └──────────┘ → └─────────┘ → └────────┘ → └─────┘ → └───────────┘ → └─────┘ → └──────┘",
  ]);
  assert.deepEqual(after.slice(2, 6), before.slice(2, 6));
  assert.notDeepEqual(after, before, "selection move must change card rows below");
});
test("actions view shows a preparing state and ignores stale resolutions (S1)", async (t) => {
  const resolvers: Array<(r: PrepareResponse) => void> = [];
  const prepare = (name: string): Promise<PrepareResponse> =>
    new Promise((res) => resolvers.push(res));
  const h = makeHarness({ prepare });
  t.after(() => h.screen.dispose());
  await settle();

  // Open T3-review detail, then its action menu.
  h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN);
  h.screen.handleInput(ENTER);
  h.screen.handleInput("x");

  const preparing = h.screen.render(W).join("\n");
  assert.ok(preparing.includes("preparing actions…"), "expected preparing state while prepare calls are in flight");
  assert.ok(resolvers.length > 0, "expected prepare calls to be issued");

  // Resolve the first round (draining as new prepares appear) — menu appears.
  await drain(resolvers);
  const menu = h.screen.render(W).join("\n");
  assert.ok(!menu.includes("preparing actions…"), `expected menu, got: ${menu}`);
  assert.ok(menu.includes("Remove worktree"), `expected menu rows, got: ${menu}`);

  // Stale-guard: start a new round, leave the view, then resolve the stale
  // prepares. The screen must stay on detail and must not apply the stale rows.
  h.screen.handleInput(ESC); // actions -> detail
  h.screen.handleInput("x"); // new prepare round stays pending
  assert.ok(resolvers.length > 0);
  h.screen.handleInput(ESC); // leave mid-prepare
  const detailBefore = h.screen.render(W).join("\n");
  assert.ok(detailBefore.includes("T3-review"));
  await drain(resolvers); // stale resolution must be ignored
  await settle();
  const detailAfterStale = h.screen.render(W).join("\n");
  assert.ok(detailAfterStale.includes("T3-review"), "stale prepare resolution must not change the view");

  // A fresh round still completes normally.
  h.screen.handleInput("x");
  await drain(resolvers);
  const menu2 = h.screen.render(W).join("\n");
  assert.ok(menu2.includes("Remove worktree"));
});

test("agent row with no owning unit surfaces feedback (N4)", async (t) => {
  const h = makeHarness();
  t.after(() => h.screen.dispose());
  await settle();
  h.screen.handleInput("a"); // agents view
  h.screen.handleInput(DOWN); // select second agent (idle-x, no owning unit)
  h.screen.handleInput(ENTER);
  assert.ok(h.notifies.some((m) => m.includes("No owning unit")), `expected notify, got: ${h.notifies.join(" | ")}`);
});

test("board keyboard scrolling reaches trailing Orphaned/Closed sections (scroll edge)", async (t) => {
  const h = makeHarness({ fetch: () => Promise.resolve(fixtureSnapshotForScrollEdge()) });
  t.after(() => h.screen.dispose());
  await settle();

  const first = h.screen.render(W).join("\n");
  assert.ok(first.includes("Spec (22)"), `expected many spec cards, got:\n${first}`);
  assert.ok(!first.includes("Orphaned (2)"), "trailing sections must start below the fold");
  assert.ok(!first.includes("Closed issues (2)"), "trailing sections must start below the fold");

  // Move selection to the last unit (Done column T4-merged).
  for (let i = 0; i < 24; i++) h.screen.handleInput(DOWN);
  const atLast = h.screen.render(W).join("\n");
  assert.ok(atLast.includes("› T4-merged"), `last unit must be selected, got:\n${atLast}`);
  assert.ok(!atLast.includes("Orphaned (2)"), "selection movement alone must not reveal trailing sections");

  // One Down at the edge scrolls the viewport into the trailing sections.
  h.screen.handleInput(DOWN);
  const scrolled = h.screen.render(W).join("\n");
  assert.ok(scrolled !== atLast, "edge Down must change the visible lines");
  assert.ok(scrolled.includes("Orphaned (2)"), `expected Orphaned section, got:\n${scrolled}`);
  assert.ok(scrolled.includes("Closed issues (2)"), `expected Closed issues section, got:\n${scrolled}`);
  assert.ok(scrolled.includes("  #53 Closed issue without a unit [done]"), `got:\n${scrolled}`);

  // Repeated Down clamps at the true bottom (same output, no error).
  for (let i = 0; i < 5; i++) h.screen.handleInput(DOWN);
  const bottom = h.screen.render(W).join("\n");
  assert.ok(bottom.includes("Closed issues (2)"), `bottom must show Closed issues, got:\n${bottom}`);
  assert.ok(bottom.includes("  #60 Another closed orphan issue [closed]"), `got:\n${bottom}`);
  h.screen.handleInput(DOWN);
  const clamped = h.screen.render(W).join("\n");
  assert.equal(clamped, bottom, "further Down presses must clamp without changing output");

  // Up moves selection back up; PageUp restores selection visibility at the top.
  h.screen.handleInput(UP);
  const upOne = h.screen.render(W).join("\n");
  assert.ok(upOne.includes("› #7 Add sound effects"), `Up from bottom must move selection to T3-review, got:\n${upOne}`);
  h.screen.handleInput(PGUP);
  const top = h.screen.render(W).join("\n");
  assert.ok(top.includes("› #12 Mobile touch controls"), `PageUp must restore first-unit selection, got:\n${top}`);
  assert.ok(!top.includes("Orphaned (2)"), "viewport should be back near the top");
  h.screen.handleInput(PGUP);
  const absoluteTop = h.screen.render(W).join("\n");
  assert.ok(absoluteTop.includes("Spec (22)"), `expected column header at the very top, got:\n${absoluteTop}`);
  h.screen.handleInput(PGUP);
  const topClamped = h.screen.render(W).join("\n");
  assert.equal(topClamped, absoluteTop, "further PageUp presses must clamp at the top");
});

test("board trailing sections are informational: click no-op, Enter opens the selected unit", async (t) => {
  const h = makeHarness({ fetch: () => Promise.resolve(fixtureSnapshotForScrollEdge()) });
  t.after(() => h.screen.dispose());
  await settle();

  // First render establishes the viewport/region so edge scrolling applies.
  h.screen.render(W);

  // Move to the last unit then scroll to the bottom so section rows are on screen.
  for (let i = 0; i < 24; i++) h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN); // edge scroll to bottom
  const bottom = h.screen.render(W).join("\n");
  assert.ok(bottom.includes("Orphaned (2)"), `expected sections visible, got:\n${bottom}`);

  // Click on the Orphaned section header row: head=6, section row 34, scrollTop=10.
  const mouse: TuiMouseEvent = {
    type: "click",
    button: "left",
    x: 2,
    y: 6 + (34 - 10),
    screenX: 2,
    screenY: 30,
    width: W,
    height: 40,
    shift: false,
    alt: false,
    ctrl: false,
  };
  h.screen.handleMouse(mouse);
  const afterClick = h.screen.render(W).join("\n");
  assert.ok(afterClick.includes("› T4-merged"), "clicking a section must not change selection");
  assert.equal(afterClick, bottom, "section click must be a no-op");

  // Enter operates on the still-selected unit (opens its detail), not a section.
  h.screen.handleInput(ENTER);
  const detail = h.screen.render(W).join("\n");
  assert.ok(detail.includes("T4-merged"), `Enter must open the selected unit detail, got:\n${detail}`);
  assert.ok(!detail.includes("Orphaned (2)"), "detail view has no trailing sections");
});

test("mouse wheel scrolling still works independently of selection (no regression)", async (t) => {
  const h = makeHarness({ fetch: () => Promise.resolve(fixtureSnapshotForScrollEdge()) });
  t.after(() => h.screen.dispose());
  await settle();

  const first = h.screen.render(W).join("\n");
  assert.ok(!first.includes("Closed issues (2)"), "trailing sections start below the fold");

  const wheel = (delta: number): TuiMouseEvent => ({
    type: "wheel",
    button: "none",
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    width: W,
    height: 40,
    shift: false,
    alt: false,
    ctrl: false,
    wheelDelta: delta,
  });

  h.screen.handleMouse(wheel(20)); // big scroll to the bottom
  const bottom = h.screen.render(W).join("\n");
  assert.ok(bottom.includes("Closed issues (2)"), `wheel down must reach the bottom, got:\n${bottom}`);
  assert.ok(bottom.includes("  #60 Another closed orphan issue [closed]"), `got:\n${bottom}`);

  h.screen.handleMouse(wheel(-20)); // back to the top
  const top = h.screen.render(W).join("\n");
  assert.ok(top.includes("Spec (22)"), `wheel up must return to the top, got:\n${top}`);
  assert.ok(!top.includes("Orphaned (2)"), "wheel up must hide trailing sections again");
});
