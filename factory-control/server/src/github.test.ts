import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStateFromResult, summarizeChecks, type GhCheck } from "./github.ts";
import type { RunResult } from "./git.ts";

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
