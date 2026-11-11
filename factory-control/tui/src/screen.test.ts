/**
 * Interactive-screen regression tests (B1 cache-invalidation, S1 preparing
 * state / stale-guard, N4 agent-without-owner feedback).
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { DispatchPrepareResponse, PrepareResponse } from "./api.ts";
import { fixtureSnapshot } from "./fixtures.ts";
import { FactoryScreen } from "./screen.ts";

const DOWN = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";
const W = 100;

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
        (binding === "tui.select.down" && data === DOWN) ||
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
