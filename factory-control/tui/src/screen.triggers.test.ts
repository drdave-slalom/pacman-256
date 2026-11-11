/**
 * M4 trigger-flow screen tests: dispatch/skill menu rows, confirm-enqueue,
 * the queue view, and the lead-prompt copy helper.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { DispatchEntryLike, DispatchPrepareResponse, PrepareResponse } from "./api.ts";
import { fixtureSnapshot } from "./fixtures.ts";
import { FactoryScreen } from "./screen.ts";

const DOWN = "\u001b[B";
const ENTER = "\r";
const ESC = "\u001b";
const W = 120;

const QUEUED: DispatchEntryLike = {
  id: "req-abc123",
  at: "2026-01-01T00:00:00.000Z",
  unit: "T1-spec",
  specPath: "SPEC/T1-spec.md",
  worktree: "factory/t1-spec",
  role: "builder",
  acceptance: "Implement T1-spec per SPEC/T1-spec.md.",
  status: "queued",
  prompt: "LEAD DELEGATION PROMPT — queue req-abc123\nUnit:       T1-spec\nRole:       builder\nAcceptance:\n  Implement T1-spec per SPEC/T1-spec.md.\n",
};

interface HarnessOptions {
  fetch?: () => Promise<FactorySnapshot>;
  prepare?: (name: string, body: Record<string, unknown>) => Promise<PrepareResponse>;
  dispatchPrepare?: (body: { unit: string; skill?: string }) => Promise<DispatchPrepareResponse>;
  dispatchEnqueue?: (requestId: string) => Promise<{ entry: DispatchEntryLike; prompt: string }>;
  dispatchQueue?: () => Promise<{ entries: DispatchEntryLike[] }>;
  confirm?: () => Promise<boolean>;
}

function makeHarness(opts: HarnessOptions = {}) {
  const notifies: string[] = [];
  let doneCalls = 0;
  let ctx: ExtensionContext = {
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
  if (opts.confirm !== undefined) {
    ctx = { ...ctx, ui: { ...ctx.ui, confirm: opts.confirm } } as unknown as ExtensionContext;
  }
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
    ...(opts.dispatchPrepare !== undefined ? { dispatchPrepareImpl: opts.dispatchPrepare } : {}),
    ...(opts.dispatchEnqueue !== undefined ? { dispatchEnqueueImpl: opts.dispatchEnqueue } : {}),
    ...(opts.dispatchQueue !== undefined ? { dispatchQueueImpl: opts.dispatchQueue } : {}),
  });
  return { screen, notifies, doneCalls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function okPrepare(): Promise<PrepareResponse> {
  return Promise.resolve({ requestId: "rid", ok: true, preconditions: [], plan: { summary: "plan", steps: [] } });
}

function okDispatchPrepare(): Promise<DispatchPrepareResponse> {
  return Promise.resolve({
    requestId: "prep-1",
    entryId: "req-abc123",
    ok: true,
    preconditions: [],
    plan: {
      kind: "dispatch",
      unit: "T1-spec",
      role: "builder",
      worktree: "factory/t1-spec",
      specPath: "SPEC/T1-spec.md",
      acceptance: "Implement T1-spec per SPEC/T1-spec.md.",
      summary: "Dispatch T1-spec to a builder agent",
      delegationPrompt: QUEUED.prompt ?? "",
    },
  });
}

test("Spec card actions menu offers Dispatch unit; confirm enqueues and shows the lead prompt", async (t) => {
  const h = makeHarness({
    prepare: okPrepare,
    dispatchPrepare: okDispatchPrepare,
    dispatchEnqueue: async (requestId) => {
      assert.equal(requestId, "prep-1");
      return { entry: QUEUED, prompt: QUEUED.prompt ?? "" };
    },
  });
  t.after(() => h.screen.dispose());
  await flush();

  // T1-spec is the first (selected) unit → enter detail, then actions.
  h.screen.handleInput(ENTER);
  h.screen.handleInput("x");
  await flush();

  const menu = h.screen.render(W).join("\n");
  assert.ok(menu.includes("Dispatch unit"), `expected Dispatch unit row, got: ${menu}`);

  // Select the Dispatch unit row (it follows worktree/create) and open it.
  h.screen.handleInput(DOWN);
  h.screen.handleInput(ENTER);
  await flush();

  const plan = h.screen.render(W).join("\n");
  assert.ok(plan.includes("delegation plan"), `expected trigger plan, got: ${plan}`);
  assert.ok(plan.includes("builder"));
  assert.ok(plan.includes("confirm & enqueue"));

  // Confirm → enqueue → lead-prompt view + notify.
  h.screen.handleInput(ENTER);
  await flush();
  const promptView = h.screen.render(W).join("\n");
  assert.ok(promptView.includes("Lead delegation prompt"), `expected prompt view, got: ${promptView}`);
  assert.ok(promptView.includes("req-abc123"));
  assert.ok(h.notifies.some((m) => m.includes("Enqueued")), `expected notify, got: ${h.notifies.join(" | ")}`);
});

test("rejected dispatch prepare shows reasons and no runnable row", async (t) => {
  const h = makeHarness({
    prepare: okPrepare,
    dispatchPrepare: () =>
      Promise.resolve({
        requestId: "prep-2",
        entryId: "req-abc124",
        ok: false,
        preconditions: [{ name: "no-worktree", ok: false, detail: "a worktree already exists" }],
        plan: {
          kind: "dispatch",
          unit: "T1-spec",
          role: "builder",
          worktree: "factory/t1-spec",
          specPath: "SPEC/T1-spec.md",
          acceptance: "a",
          summary: "s",
          delegationPrompt: "p",
        },
      }),
  });
  t.after(() => h.screen.dispose());
  await flush();
  h.screen.handleInput(ENTER);
  h.screen.handleInput("x");
  await flush();
  const menu = h.screen.render(W).join("\n");
  assert.ok(menu.includes("Dispatch unit"));
  assert.ok(menu.includes("no-worktree: a worktree already exists"));
});

test("queue view lists entries and opens the lead prompt; copy notifies", async (t) => {
  const h = makeHarness({ dispatchQueue: async () => ({ entries: [QUEUED] }) });
  t.after(() => h.screen.dispose());
  await flush();

  h.screen.handleInput("q");
  await flush();
  const queue = h.screen.render(W).join("\n");
  assert.ok(queue.includes("Dispatch queue"));
  assert.ok(queue.includes("queued"));
  assert.ok(queue.includes("req-abc123"));

  h.screen.handleInput(ENTER);
  await flush();
  const prompt = h.screen.render(W).join("\n");
  assert.ok(prompt.includes("Lead delegation prompt"));
  h.screen.handleInput("c");
  assert.ok(h.notifies.some((m) => m.includes("Lead prompt for req-abc123")), `expected copy notify, got: ${h.notifies.join(" | ")}`);

  // esc returns to the queue view
  h.screen.handleInput(ESC);
  await flush();
  const back = h.screen.render(W).join("\n");
  assert.ok(back.includes("Dispatch queue"));
});
