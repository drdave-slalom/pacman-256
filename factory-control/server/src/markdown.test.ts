import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSpecUnit, referencedIssueNumbers } from "./markdown.ts";

test("referencedIssueNumbers: extracts #N and Closes #N, dedupes, sorts", () => {
  assert.deepEqual(referencedIssueNumbers("Closes #12 and #3, part of #12."), [3, 12]);
  assert.deepEqual(referencedIssueNumbers("Tracker: [#59](https://github.com/o/r/issues/59)"), [59]);
  assert.deepEqual(referencedIssueNumbers("no references here"), []);
});

test("referencedIssueNumbers: ignores headings and word-embedded #", () => {
  // ATX headings (# Title, ## Goal) are not issue references.
  assert.deepEqual(referencedIssueNumbers("# Heading\n\n## Goal\n\n#42 is real\n"), [42]);
  // `shared#1` (word-embedded) is not a standalone #N.
  assert.deepEqual(referencedIssueNumbers("result:fc-issue-sync-shared#1 and abc#9"), []);
  assert.deepEqual(referencedIssueNumbers("#123 afoot"), [123]);
});

test("readSpecUnit: collects referenced issue numbers from a spec file", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-md-"));
  try {
    const rel = join("SPEC", "T3-foo.md");
    mkdirSync(join(root, "SPEC"));
    writeFileSync(join(root, rel), "# T3 spec\n\nCloses #12 and #7. Part of #7.\n\n## Goal\n\nFoo.\n");
    const unit = readSpecUnit(root, rel);
    assert.deepEqual(unit.issueRefs, [7, 12]);
    assert.equal(unit.id, "t3foo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSpecUnit: unreadable spec yields parseError without issueRefs", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-md-")));
  try {
    const unit = readSpecUnit(root, join("SPEC", "missing.md"));
    assert.ok(unit.parseError);
    assert.equal(unit.issueRefs, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
