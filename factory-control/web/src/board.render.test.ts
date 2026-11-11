import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildSync } from "esbuild";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import { fixtureSnapshot, fixtureSnapshotWithClosedIssues } from "./state/fixtures.ts";

/**
 * Board render tests for always-on closed issues: the section is always
 * rendered when closed-unmatched issues exist (no checkbox/toggle). The real
 * components are bundled (esbuild, node platform) into a temp module and
 * rendered with `react-dom/server` — no browser required.
 */

const ssrEntry = fileURLToPath(new URL("./ssr.ts", import.meta.url));

type SsrModule = {
  renderPage?: (snapshot: FactorySnapshot, path: string) => string;
  renderBoardContent?: (snapshot: FactorySnapshot) => string;
  default?: {
    renderPage: (snapshot: FactorySnapshot, path: string) => string;
    renderBoardContent: (snapshot: FactorySnapshot) => string;
  };
};

function compileSsr(): Promise<SsrModule> {
  const outfile = join(mkdtempSync(join(tmpdir(), "fc-web-board-ssr-")), "ssr.cjs");
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

function renderPageOf(mod: SsrModule): (snapshot: FactorySnapshot, path: string) => string {
  const renderPage = mod.renderPage ?? mod.default?.renderPage;
  assert.ok(renderPage, "ssr bundle missing renderPage");
  return renderPage;
}

function renderBoardContentOf(mod: SsrModule): (snapshot: FactorySnapshot) => string {
  const renderBoardContent = mod.renderBoardContent ?? mod.default?.renderBoardContent;
  assert.ok(renderBoardContent, "ssr bundle missing renderBoardContent");
  return renderBoardContent;
}

/** React SSR splits JSX text nodes with `<!-- -->` comment separators. */
function stripComments(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

test("board always renders exactly the closed-unmatched issues column (no checkbox)", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshotWithClosedIssues(), "/");

  // No toggle artifacts remain.
  assert.ok(!html.includes("Show closed issues"), "toggle label must be gone");
  assert.ok(!html.includes('type="checkbox"'), "checkbox must be gone");
  assert.ok(!html.includes("toolbar-toggle"), "toolbar toggle class must be gone");

  const sectionStart = html.indexOf('class="column column-issues"');
  assert.ok(sectionStart >= 0, "must render a Closed issues column");
  const section = html.slice(sectionStart);

  assert.ok(section.includes("<h2>Closed issues</h2>"), "missing Closed issues heading");
  assert.equal((section.match(/closed-issue-item/g) ?? []).length, 2, "expected exactly the two closed-unmatched rows");

  // Rows link to the GitHub issue URL and show the status chip.
  assert.ok(section.includes('href="https://github.com/x/pacman-256/issues/53"'), "missing #53 link");
  assert.ok(section.includes('href="https://github.com/x/pacman-256/issues/60"'), "missing #60 link");
  const text = stripComments(section);
  assert.ok(text.includes("#53 Closed issue without a unit"), "missing #53 row text");
  assert.ok(text.includes("#60 Another closed orphan issue"), "missing #60 row text");
  assert.equal((section.match(/chip-status/g) ?? []).length, 2, "expected a status chip per row");
  assert.ok(section.includes(">done<") || section.includes("done"), "expected #53 status label (done)");
  assert.ok(section.includes(">closed<") || section.includes("closed"), "expected #60 status label (closed)");

  // The closed issue already attached to a unit (#17) must not be duplicated.
  assert.ok(!section.includes("/issues/17"), "closed section must not duplicate the linked #17 issue");
});

test("board hides the Closed issues column when none are closed-unmatched", async () => {
  const mod = await compileSsr();
  const renderPage = renderPageOf(mod);
  const html = renderPage(fixtureSnapshot(), "/"); // #17 closed but linked; no closed-unmatched
  assert.ok(!html.includes('class="column column-issues"'), "no Closed issues column expected");
  assert.ok(!html.includes("<h2>Closed issues</h2>"), "no Closed issues heading expected");
  assert.ok(!html.includes("/issues/53"), "no closed-unmatched links expected");
});

test("renderBoardContent always includes the closed-unmatched issues", async () => {
  const mod = await compileSsr();
  const renderBoardContent = renderBoardContentOf(mod);
  const html = renderBoardContent(fixtureSnapshotWithClosedIssues());
  assert.ok(html.includes('class="column column-issues"'), "expected a Closed issues column");
  assert.ok(html.includes("<h2>Closed issues</h2>"), "expected Closed issues heading");
  assert.ok(html.includes("/issues/53"), "expected #53 link");
  assert.ok(html.includes("/issues/60"), "expected #60 link");
  assert.ok(!html.includes('type="checkbox"'), "checkbox must be gone");
});
