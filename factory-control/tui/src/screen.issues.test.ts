/**
 * U7 issue-card screen tests: board/URL, issue action input forms
 * (prepare → confirm → execute), guard reasons on rejection, and
 * factory/start-work opening the lead-prompt view.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { ActionResultLike, DispatchEntryLike, PrepareResponse } from "./api.ts";
import { fixtureSnapshotWithClosedIssues, fixtureSnapshotWithIssues } from "./fixtures.ts";
import { FactoryScreen } from "./screen.ts";

const DOWN = "\u001b[B";
const ENTER = "\r";
const W = 120;

interface HarnessOptions {
  fetch?: () => Promise<FactorySnapshot>;
  prepare?: (name: string, body: Record<string, unknown>) => Promise<PrepareResponse>;
  execute?: (name: string, requestId: string, approvedBy?: string) => Promise<ActionResultLike>;
  dispatchQueue?: () => Promise<{ entries: DispatchEntryLike[] }>;
  confirm?: () => Promise<boolean>;
  input?: (title: string) => Promise<string | undefined>;
  select?: (title: string, options: string[]) => Promise<string | undefined>;
  openUrl?: (url: string) => void;
}

function makeHarness(opts: HarnessOptions = {}) {
  const notifies: string[] = [];
  const openedUrls: string[] = [];
  let doneCalls = 0;
  let ctx: ExtensionContext = {
    cwd: "/repo/primary",
    ui: {
      setWidget: () => {},
      notify: (msg: string) => {
        notifies.push(msg);
      },
      confirm: async () => true,
      input: opts.input ?? (async () => "some text"),
      select: opts.select ?? (async () => "close"),
    },
    sessionManager: { getSessionName: () => "tester" },
  } as unknown as ExtensionContext;
  if (opts.confirm !== undefined) {
    ctx = { ...ctx, ui: { ...ctx.ui, confirm: opts.confirm } } as unknown as ExtensionContext;
  }
  const tuiBase = { requestRender: () => {}, terminal: { rows: 40 } };
  const tui =
    opts.openUrl !== undefined ? { ...tuiBase, openUrl: opts.openUrl } : tuiBase;
  const theme: Theme = { fg: (_t: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
  const screen = new FactoryScreen({
    tui: tui as TUI,
    theme,
    kb: {
      matches: (data, binding) =>
        (binding === "tui.select.down" && data === DOWN) ||
        (binding === "tui.select.confirm" && data === ENTER),
    },
    done: () => {
      doneCalls += 1;
    },
    ctx,
    query: "",
    fetchSnapshotImpl: opts.fetch ?? (() => Promise.resolve(fixtureSnapshotWithIssues())),
    prepareActionImpl:
      opts.prepare ??
      (async () => ({ requestId: "rid", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } })),
    ...(opts.execute !== undefined ? { executeActionImpl: opts.execute } : {}),
    ...(opts.dispatchQueue !== undefined ? { dispatchQueueImpl: opts.dispatchQueue } : {}),
  });
  return { screen, notifies, openedUrls, doneCalls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function selectIssue12(h: { screen: FactoryScreen }): void {
  // Flat board order (spec col sorted by id under locale collation): issue12,
  // T1-spec, T2-execute, T3-review, T4-merged — issue12 is already selected.
  h.screen.handleInput(ENTER);
}

test("board always shows the Closed issues section for closed-unmatched issues", async (t) => {
  const h = makeHarness({ fetch: () => Promise.resolve(fixtureSnapshotWithClosedIssues()) });
  t.after(() => h.screen.dispose());
  await flush();
  // No toggle keypress: the section is present on the first render.
  const joined = h.screen.render(W).join("\n");
  assert.ok(joined.includes("Closed issues (2)"), `expected always-on section, got:\n${joined}`);
  assert.ok(joined.includes("  #53 Closed issue without a unit [done]"), `got:\n${joined}`);
  assert.ok(joined.includes("  #60 Another closed orphan issue [closed]"), `got:\n${joined}`);
  // A closed issue already attached to a unit (#7) must not be duplicated.
  const closedSection = joined.slice(joined.indexOf("Closed issues (2)"));
  assert.ok(!closedSection.includes("#7"), `closed section must not duplicate linked #7:\n${closedSection}`);
});

test("board hides the Closed issues section when none are closed-unmatched", async (t) => {
  const h = makeHarness(); // fixtureSnapshotWithIssues: #12/#7 both open
  t.after(() => h.screen.dispose());
  await flush();
  const joined = h.screen.render(W).join("\n");
  assert.ok(!joined.includes("Closed issues"), `expected no closed section, got:\n${joined}`);
});

test("board renders issue cards with #n + title + status", async (t) => {
  const h = makeHarness();
  t.after(() => h.screen.dispose());
  await flush();
  const joined = h.screen.render(W).join("\n");
  assert.ok(joined.includes("#12 Mobile touch controls feel laggy [ready]"), `got:\n${joined}`);
  assert.ok(joined.includes("#7 Add sound effects [review]"), `got:\n${joined}`);
});

test("detail shows issue fields; enter opens the GitHub URL", async (t) => {
  const openedUrls: string[] = [];
  const h = makeHarness({ openUrl: (url) => openedUrls.push(url) });
  t.after(() => h.screen.dispose());
  await flush();
  selectIssue12(h);
  const detail = h.screen.render(W).join("\n");
  assert.ok(detail.includes("issue"), `expected issue section, got:\n${detail}`);
  assert.ok(detail.includes("state open"));
  assert.ok(detail.includes("https://github.com/example/repo/issues/12"));
  h.screen.handleInput(ENTER);
  assert.deepEqual(openedUrls, ["https://github.com/example/repo/issues/12"]);
});

test("issue action menu lists the new actions; comment flows input→prepare→confirm→execute", async (t) => {
  const bodies: Array<{ name: string; body: Record<string, unknown> }> = [];
  const executed: Array<{ name: string; requestId: string; approvedBy: string | undefined }> = [];
  const h = makeHarness({
    input: async (title) => {
      assert.equal(title, "Comment text");
      return "Looks good to me.";
    },
    prepare: async (name, body) => {
      bodies.push({ name, body });
      return { requestId: "rid-c", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } };
    },
    execute: async (name, requestId, approvedBy) => {
      executed.push({ name, requestId, approvedBy });
      return { outcome: "success", command: ["gh", "issue"], exit: 0, outputTail: "ok\n" };
    },
  });
  t.after(() => h.screen.dispose());
  await flush();

  selectIssue12(h);
  h.screen.handleInput("x");
  await flush();
  const menu = h.screen.render(W).join("\n");
  for (const label of ["Comment on issue", "Change issue labels", "Close / reopen issue", "Start work"]) {
    assert.ok(menu.includes(label), `expected menu row "${label}", got:\n${menu}`);
  }

  // Comment row is first (input actions precede start-work).
  h.screen.handleInput(ENTER);
  await flush();
  const plan = h.screen.render(W).join("\n");
  assert.ok(plan.includes("Comment on issue"), `expected plan heading, got:\n${plan}`);
  assert.ok(
    bodies.some((b) => b.name === "github/issue-comment" && b.body.comment === "Looks good to me."),
    `expected comment in prepare body, got ${JSON.stringify(bodies)}`,
  );

  h.screen.handleInput(ENTER);
  await flush();
  assert.equal(executed.length, 1);
  assert.equal(executed[0]?.name, "github/issue-comment");
  assert.equal(executed[0]?.requestId, "rid-c");
  const result = h.screen.render(W).join("\n");
  assert.ok(result.includes("success"), `expected success result, got:\n${result}`);
});

test("state action gathers a select choice and sends it in the prepare body", async (t) => {
  let selectedTitle = "";
  const bodies: Array<{ name: string; body: Record<string, unknown> }> = [];
  const h = makeHarness({
    select: async (title) => {
      selectedTitle = title;
      return "reopen";
    },
    prepare: async (name, body) => {
      bodies.push({ name, body });
      return { requestId: "rid-s", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } };
    },
  });
  t.after(() => h.screen.dispose());
  await flush();
  selectIssue12(h);
  h.screen.handleInput("x");
  await flush();
  h.screen.handleInput(DOWN); // comment → labels
  h.screen.handleInput(DOWN); // labels → state
  h.screen.handleInput(ENTER);
  await flush();
  assert.equal(selectedTitle, "Issue state");
  assert.ok(
    bodies.some((b) => b.name === "github/issue-state" && b.body.state === "reopen"),
    `expected state in prepare body, got ${JSON.stringify(bodies)}`,
  );
});

test("rejected issue prepare shows guard reasons in the action detail", async (t) => {
  const h = makeHarness({
    prepare: async (name) =>
      name === "github/issue-comment"
        ? {
            requestId: "rid-x",
            ok: false,
            preconditions: [{ name: "gh-auth", ok: false, detail: "gh not authenticated" }],
            plan: { summary: "plan", steps: [] },
          }
        : { requestId: "rid", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } },
  });
  t.after(() => h.screen.dispose());
  await flush();
  selectIssue12(h);
  h.screen.handleInput("x");
  await flush();
  h.screen.handleInput(ENTER); // open comment row → input → prepare rejected
  await flush();
  const plan = h.screen.render(W).join("\n");
  assert.ok(plan.includes("trigger blocked by preconditions"), `expected blocked banner, got:\n${plan}`);
  assert.ok(plan.includes("gh-auth"));
  assert.ok(plan.includes("gh not authenticated"));
});

test("start-work confirms, executes, and opens the lead-prompt view", async (t) => {
  const QUEUED: DispatchEntryLike = {
    id: "req-start1",
    at: "2026-01-12T09:00:00.000Z",
    unit: "issue12",
    specPath: "SPEC/issue12-slug.md",
    worktree: "factory/issue12-slug",
    role: "builder",
    acceptance: "Implement issue #12.",
    status: "queued",
    prompt: "LEAD PROMPT for issue12\nUnit: issue12\n",
  };
  const h = makeHarness({
    dispatchQueue: async () => ({ entries: [QUEUED] }),
    execute: async (name, requestId, approvedBy) => {
      assert.equal(name, "factory/start-work");
      return { outcome: "success", command: ["gh"], exit: 0, outputTail: "scaffolded\n" };
    },
  });
  t.after(() => h.screen.dispose());
  await flush();
  selectIssue12(h);
  h.screen.handleInput("x");
  await flush();
  // start-work row is last: comment/labels/state → start-work.
  h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN);
  h.screen.handleInput(ENTER); // open start-work → plan
  await flush();
  const plan = h.screen.render(W).join("\n");
  assert.ok(plan.includes("Start work"), `expected start-work plan, got:\n${plan}`);
  h.screen.handleInput(ENTER); // confirm → execute → lead-prompt
  await flush();
  const promptView = h.screen.render(W).join("\n");
  assert.ok(promptView.includes("Lead delegation prompt"), `expected prompt view, got:\n${promptView}`);
  assert.ok(promptView.includes("req-start1"));
  assert.ok(h.notifies.some((m) => m.includes("Start-work done")), `expected notify, got: ${h.notifies.join(" | ")}`);
});

test("start-work with no queue entry stays on the result view", async (t) => {
  const h = makeHarness({
    dispatchQueue: async () => ({ entries: [] }),
    execute: async () => ({ outcome: "success", command: ["gh"], exit: 0, outputTail: "ok\n" }),
  });
  t.after(() => h.screen.dispose());
  await flush();
  selectIssue12(h);
  h.screen.handleInput("x");
  await flush();
  h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN);
  h.screen.handleInput(DOWN);
  h.screen.handleInput(ENTER);
  await flush();
  h.screen.handleInput(ENTER);
  await flush();
  const view = h.screen.render(W).join("\n");
  assert.ok(view.includes("success"), `expected result view, got:\n${view}`);
  assert.ok(!view.includes("Lead delegation prompt"));
});
