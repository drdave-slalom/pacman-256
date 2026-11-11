import test from "node:test";
import assert from "node:assert/strict";
import { handleKey, type FactoryScreenOps, type KeyMatcher } from "./keyroutes.ts";

/** Fake KeybindingsManager: a binding matches only the exact data string bound to it. */
function kbThat(bindingToData: Record<string, string>, data: string): KeyMatcher {
  return {
    matches: (binding) => bindingToData[binding] === data,
  };
}

function makeOps() {
  const calls: string[] = [];
  const ops: FactoryScreenOps = {
    moveSelection: (d) => calls.push(`move:${d}`),
    pageSelection: (d) => calls.push(`page:${d}`),
    openSelected: () => calls.push("openSelected"),
    openAgents: () => calls.push("openAgents"),
    openActions: () => calls.push("openActions"),
    back: () => calls.push("back"),
    refresh: () => calls.push("refresh"),
    close: () => calls.push("close"),
    startServer: () => calls.push("startServer"),
    openQueue: () => calls.push("openQueue"),
    copyLeadPrompt: () => calls.push("copyLeadPrompt"),
  };
  return { calls, ops };
}

test("arrow keys route to moveSelection via keybindings", () => {
  const { calls, ops } = makeOps();
  handleKey("up", kbThat({ "tui.select.up": "up" }, "up"), ops);
  handleKey("down", kbThat({ "tui.select.down": "down" }, "down"), ops);
  assert.deepEqual(calls, ["move:-1", "move:1"]);
});

test("enter routes to openSelected, escape to back", () => {
  const { calls, ops } = makeOps();
  handleKey("enter", kbThat({ "tui.select.confirm": "enter" }, "enter"), ops);
  handleKey("escape", kbThat({ "tui.select.cancel": "escape" }, "escape"), ops);
  assert.deepEqual(calls, ["openSelected", "back"]);
});

test("page keys route to pageSelection", () => {
  const { calls, ops } = makeOps();
  handleKey("pageUp", kbThat({ "tui.select.pageUp": "pageUp" }, "pageUp"), ops);
  handleKey("pageDown", kbThat({ "tui.select.pageDown": "pageDown" }, "pageDown"), ops);
  assert.deepEqual(calls, ["page:-1", "page:1"]);
});

test("direct keys route to agents/actions/refresh/server/queue/copy", () => {
  const { calls, ops } = makeOps();
  handleKey("a", kbThat({}, "a"), ops);
  handleKey("x", kbThat({}, "x"), ops);
  handleKey("r", kbThat({}, "r"), ops);
  handleKey("s", kbThat({}, "s"), ops);
  handleKey("q", kbThat({}, "q"), ops);
  handleKey("c", kbThat({}, "c"), ops);
  handleKey("i", kbThat({}, "i"), ops);
  handleKey("I", kbThat({}, "I"), ops);
  assert.deepEqual(calls, [
    "openAgents",
    "openActions",
    "refresh",
    "startServer",
    "openQueue",
    "copyLeadPrompt",
  ]);
});

test("unknown keys are ignored", () => {
  const { calls, ops } = makeOps();
  handleKey("z", kbThat({}, "z"), ops);
  handleKey("\u001b[1;5C", kbThat({}, "\u001b[1;5C"), ops);
  assert.deepEqual(calls, []);
});

test("binding matches take precedence over direct letters", () => {
  const { calls, ops } = makeOps();
  // If a user rebinds 'a' to tui.select.confirm, confirm wins.
  handleKey("a", kbThat({ "tui.select.confirm": "a" }, "a"), ops);
  assert.deepEqual(calls, ["openSelected"]);
});
