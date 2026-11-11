import test from "node:test";
import assert from "node:assert/strict";
import { renderLeadPrompt, renderQueueView, plainStyle } from "./render.ts";
import type { DispatchEntryLike } from "./api.ts";
import { visibleWidth } from "./width.ts";

const ENTRY: DispatchEntryLike = {
  id: "req-abc123",
  at: "2026-01-01T00:00:00.000Z",
  unit: "t1fx",
  specPath: "SPEC/T1-fx.md",
  worktree: "factory/t1fx",
  role: "builder",
  acceptance: "Implement t1fx per SPEC/T1-fx.md.",
  status: "queued",
  prompt: [
    "LEAD DELEGATION PROMPT — queue req-abc123",
    "Unit:       t1fx",
    "Role:       builder",
    "Worktree:   /tmp/pacman-256-wt-t1fx   (branch factory/t1fx)",
    "Acceptance:",
    "  Implement t1fx per SPEC/T1-fx.md.",
    "delegate_agent({ definition: \"builder\", ... })",
  ].join("\n"),
};

function assertLinesFit(lines: string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `line exceeds ${width}: ${JSON.stringify(line)}`);
  }
}

test("renderQueueView lists entries with status, id, unit, role, spec", () => {
  const lines = renderQueueView([ENTRY], 0, plainStyle, 100);
  const joined = lines.join("\n");
  assert.ok(joined.includes("Dispatch queue"));
  assert.ok(joined.includes("queued"));
  assert.ok(joined.includes("req-abc123"));
  assert.ok(joined.includes("t1fx"));
  assert.ok(joined.includes("builder"));
  assert.ok(joined.includes("SPEC/T1-fx.md"));
  assert.ok(joined.includes("enter = lead prompt"));
  assertLinesFit(lines, 100);
});

test("renderQueueView shows the empty state", () => {
  const lines = renderQueueView([], 0, plainStyle, 100);
  assert.ok(lines.join("\n").includes("no entries"));
  assertLinesFit(lines, 100);
});

test("renderLeadPrompt prints the ready-to-use delegation prompt", () => {
  const lines = renderLeadPrompt(ENTRY, plainStyle, 120);
  const joined = lines.join("\n");
  assert.ok(joined.includes("Lead delegation prompt"));
  assert.ok(joined.includes("req-abc123"));
  assert.ok(joined.includes("delegate_agent")); // example prompt content
  assert.ok(joined.includes("Unit:       t1fx"));
  assertLinesFit(lines, 120);
});
