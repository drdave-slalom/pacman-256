import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { fixtureSnapshot } from "./state/fixtures.ts";

/**
 * Integration-style rendering test. Node's type stripping cannot execute TSX,
 * so the real components are bundled (esbuild, node platform) into a temp
 * module and rendered with `react-dom/server` against the fixture snapshot —
 * no browser required. The same snapshot types and components are what the
 * Vite app ships.
 */

const ssrEntry = fileURLToPath(new URL("./ssr.ts", import.meta.url));

type SsrModule = {
  renderPage?: (snapshot: ReturnType<typeof fixtureSnapshot>, path: string) => string;
  renderUnreachable?: () => string;
  default?: { renderPage: (snapshot: ReturnType<typeof fixtureSnapshot>, path: string) => string; renderUnreachable: () => string };
};

function compileSsr(): Promise<SsrModule> {
  const outfile = join(mkdtempSync(join(tmpdir(), "fc-web-ssr-")), "ssr.cjs");
  buildSync({
    entryPoints: [ssrEntry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    jsx: "automatic",
    logLevel: "silent",
  });
  return import(outfile) as Promise<SsrModule>;
}

function renderPageOf(mod: SsrModule): (snapshot: ReturnType<typeof fixtureSnapshot>, path: string) => string {
  const renderPage = mod.renderPage ?? mod.default?.renderPage;
  assert.ok(renderPage, "ssr bundle missing renderPage");
  return renderPage;
}

test("board renders every unit card with stage columns and attention badges", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/");
  for (const expected of [
    "Spec", "Dispatch", "Execute", "Review", "QA", "Integrate", "CI", "Done", "Unknown", "Orphaned",
    "T10-execute", "T11-review", "T12-integrate", "T13-unknown", "T14-done", "T15-parse",
    "Review pending", "Ready to merge", "Ready for cleanup", "Parse error",
    "PR #42", "@factory/t10-execute", "+42 −7", "● dirty",
  ]) {
    assert.ok(html.includes(expected), `board missing ${expected}`);
  }
});

test("unit detail renders spec, git, PR/checks, and the handoff trail", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/unit/T11-review");
  for (const expected of [
    "T11: review fixture",
    "Prove the review stage renders a pending review.",
    "Multiplayer",
    "@factory/t11-review",
    "PR", "#43", "pending",
    "Handoff trail",
    "builder", "pr-reviewer",
    "result:builder#4", "result:pr-reviewer#1",
    "Implemented the detail view.",
    "Review pending",
    "Assign PR review",
    "display-only",
  ]) {
    assert.ok(html.includes(expected), `detail missing ${expected}`);
  }
});

test("agents panel renders lifecycle rows with glyphs and context", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/agents");
  for (const expected of [
    "Herd",
    "builder-fc-t10-execute", "pr-reviewer-fc-t11-review", "qa-tester-fc-t09-starting", "scout-fc-mystery",
    "Working", "Idle", "Lost", "Starting",
    "mercury-1", "31% ctx", "stale", "thinking",
  ]) {
    assert.ok(html.includes(expected), `agents missing ${expected}`);
  }
});

test("detail shows a friendly state for an unknown unit", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/unit/NOPE");
  assert.ok(html.includes("Unknown unit"));
  assert.ok(html.includes("Back to board"));
});

test("malformed unit route (/unit/%zz) falls back to NotFound", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/unit/%zz");
  assert.ok(html.includes("Page not found"));
  assert.ok(!html.includes("Unknown unit"), "must not hit the decode path");
});

test("unreachable control server renders a friendly state (never a blank crash)", async () => {
  const mod = await compileSsr();
  const renderUnreachable = mod.renderUnreachable ?? mod.default?.renderUnreachable;
  assert.ok(renderUnreachable, "ssr bundle missing renderUnreachable");
  const html = renderUnreachable();
  assert.ok(html.includes("Control server not reachable"));
  assert.ok(html.includes("/api/snapshot"));
  assert.ok(html.includes("Retry"));
});
