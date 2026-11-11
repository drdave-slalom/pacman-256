import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStateFromResult, readGitHub, summarizeChecks, type GhCheck } from "./github.ts";
import { run } from "./git.ts";
import type { RunResult } from "./git.ts";

type Runner = typeof run;

/** A fake gh runner keyed on the subcommand (`list` vs per-PR `checks`). */
function runnerFor(listResult: RunResult, checksResult: RunResult): Runner {
  return async (_command: string, args: string[]) => {
    return args.includes("list") ? listResult : checksResult;
  };
}

function prJson(): string {
  return JSON.stringify([
    { number: 1, title: "T1", state: "OPEN", headRefName: "factory/t1", url: "https://ex/u1" },
    { number: 7, title: "T7", state: "OPEN", headRefName: "factory/t7", url: "https://ex/u7" },
  ]);
}

function okResult(stdout: string): RunResult {
  return { ok: true, stdout, stderr: "", status: 0 };
}

function failResult(stderr: string): RunResult {
  return { ok: false, stdout: "", stderr, status: 1 };
}

test("summarizeChecks: all SUCCESS → green", () => {
  const checks: GhCheck[] = [
    { state: "SUCCESS", bucket: "pass", name: "Validate", workflow: "CI" },
    { state: "SUCCESS", bucket: "pass", name: "lint" },
  ];
  assert.equal(summarizeChecks(checks), "green");
});

test("summarizeChecks: any FAILURE/ERROR → red", () => {
  assert.equal(summarizeChecks([{ state: "FAILURE" }, { state: "SUCCESS" }]), "red");
  assert.equal(summarizeChecks([{ state: "ERROR" }]), "red");
  assert.equal(summarizeChecks([{ state: "CANCELED" }]), "red");
  assert.equal(summarizeChecks([{ state: "SUCCESS", bucket: "fail" }]), "red");
});

test("summarizeChecks: pending/queued → pending", () => {
  assert.equal(summarizeChecks([{ state: "PENDING" }]), "pending");
  assert.equal(summarizeChecks([{ state: "QUEUED" }]), "pending");
  assert.equal(summarizeChecks([{ state: "IN_PROGRESS" }]), "pending");
  assert.equal(summarizeChecks([{ state: "SUCCESS" }, { state: "QUEUED" }]), "pending");
});

test("summarizeChecks: empty list → none", () => {
  assert.equal(summarizeChecks([]), "none");
});

test("summarizeChecks: unrecognized state without bucket → unknown", () => {
  assert.equal(summarizeChecks([{ state: "COMPLETED" }]), "unknown");
  assert.equal(summarizeChecks([{ state: "SUCCESS" }, { state: "WEIRD" }]), "unknown");
});

test("checkStateFromResult: parses a valid gh JSON array", () => {
  const json = JSON.stringify([{ state: "SUCCESS", bucket: "pass" }, { state: "SUCCESS", bucket: "pass" }]);
  assert.equal(checkStateFromResult(okResult(json)), "green");
});

test("checkStateFromResult: 'no checks reported' → none", () => {
  const result = failResult("no checks reported on the 'docs/T0-gameplay-mechanics' branch");
  assert.equal(checkStateFromResult(result), "none");
});

test("checkStateFromResult: generic gh failure → unknown", () => {
  assert.equal(checkStateFromResult(failResult("gh: not logged in")), "unknown");
  assert.equal(checkStateFromResult(failResult("")) , "unknown");
});

test("checkStateFromResult: malformed JSON → unknown", () => {
  assert.equal(checkStateFromResult(okResult("not json")), "unknown");
  assert.equal(checkStateFromResult(okResult("{\"x\":1}")), "unknown");
});

test("readGitHub: parses PRs and check states via async runner", async () => {
  const list = okResult(prJson());
  const checks = okResult(JSON.stringify([{ state: "SUCCESS", bucket: "pass" }]));
  const read = await readGitHub({ noGh: false }, runnerFor(list, checks));
  assert.equal(read.unavailable, false);
  assert.equal(read.prs.length, 2);
  const pr = read.prs[0];
  assert.ok(pr);
  assert.equal(pr.number, 1);
  assert.equal(pr.title, "T1");
  assert.equal(pr.checks, "green");
  assert.equal(read.prs[1]?.checks, "green");
  assert.deepEqual(read.errors, []);
});

test("readGitHub: hanging gh checks child times out → PR degrades to unknown + errors entry", async () => {
  const list = okResult(prJson());
  const timedOut: RunResult = { ok: false, stdout: "", stderr: "", status: null, timedOut: true };
  const read = await readGitHub({ noGh: false }, runnerFor(list, timedOut));
  assert.equal(read.prs[0]?.checks, "unknown");
  assert.equal(read.prs[1]?.checks, "unknown");
  assert.ok(read.errors.some((e) => e.includes("#1") && e.includes("timed out")));
  assert.ok(read.errors.some((e) => e.includes("#7") && e.includes("timed out")));
});

test("readGitHub: gh pr list failure → unavailable + errors entry, no PRs", async () => {
  const fail = failResult("gh: not logged in\n");
  const read = await readGitHub({ noGh: false }, runnerFor(fail, fail));
  assert.equal(read.unavailable, true);
  assert.equal(read.prs.length, 0);
  assert.ok(read.errors.some((e) => e.includes("gh unavailable")));
});

test("readGitHub: invalid gh pr list JSON → not unavailable, errors entry", async () => {
  const read = await readGitHub({ noGh: false }, runnerFor(okResult("not json"), okResult("[]")));
  assert.equal(read.unavailable, false);
  assert.equal(read.prs.length, 0);
  assert.ok(read.errors.some((e) => e.includes("invalid JSON")));
});

test("readGitHub: noGh → unavailable without invoking gh", async () => {
  const read = await readGitHub({ noGh: true });
  assert.equal(read.unavailable, true);
  assert.deepEqual(read.prs, []);
});
