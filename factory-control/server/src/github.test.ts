import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStateFromResult,
  issueBodyExcerpt,
  parseIssueCard,
  parseIssueLabels,
  readGitHub,
  readGitHubIssues,
  summarizeChecks,
  type GhCheck,
} from "./github.ts";
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

test("readGitHub: collects referenced issue numbers from PR bodies", async () => {
  const list = okResult(JSON.stringify([
    { number: 60, title: "PR", state: "OPEN", headRefName: "factory/t1", url: "u", body: "Part of #59, Closes #12" },
    { number: 61, title: "No refs", state: "OPEN", headRefName: "factory/t2", url: "u", body: "nothing here" },
  ]));
  const checks = okResult(JSON.stringify([{ state: "SUCCESS", bucket: "pass" }]));
  const read = await readGitHub({ noGh: false }, runnerFor(list, checks));
  assert.deepEqual(read.prIssueRefs[60], [12, 59]);
  assert.equal(read.prIssueRefs[61], undefined);
});

test("parseIssueLabels: maps type/role/lane/status and boolean labels", () => {
  const labels = parseIssueLabels([
    { name: "type:feature" },
    { name: "role:builder" },
    { name: "role:docs" },
    { name: "lane:A" },
    { name: "status:ready" },
    { name: "blocked" },
    { name: "follow-up" },
    { name: "playtest" },
    { name: "weird" },
  ]);
  assert.equal(labels.type, "feature");
  assert.deepEqual(labels.role, ["builder", "docs"]);
  assert.equal(labels.lane, "A");
  assert.equal(labels.status, "ready");
  assert.equal(labels.blocked, true);
  assert.equal(labels.followUp, true);
  assert.equal(labels.playtest, true);
  assert.deepEqual(labels.raw, ["type:feature", "role:builder", "role:docs", "lane:A", "status:ready", "blocked", "follow-up", "playtest", "weird"]);
});

test("parseIssueLabels: tolerates missing/garbage label arrays", () => {
  const labels = parseIssueLabels(undefined);
  assert.equal(labels.type, undefined);
  assert.deepEqual(labels.role, []);
  assert.equal(labels.lane, undefined);
  assert.equal(labels.status, undefined);
  assert.equal(labels.blocked, false);
  assert.deepEqual(labels.raw, []);
});

test("issueBodyExcerpt: trims and collapses whitespace to ~200 chars", () => {
  const excerpt = issueBodyExcerpt("   Long body   with\nnewlines and extra spaces.  ");
  assert.equal(excerpt, "Long body with newlines and extra spaces.");
  const long = issueBodyExcerpt("x".repeat(500));
  assert.equal(long.length, 200);
});

function issueJson(): string {
  return JSON.stringify([
    {
      number: 59,
      title: "Factory-control: bidirectional GitHub issue sync",
      state: "OPEN",
      labels: [
        { name: "type:feature" },
        { name: "role:builder" },
        { name: "status:spec" },
        { name: "blocked" },
      ],
      assignees: [{ login: "alice" }, { login: "bob" }],
      milestone: { title: "M0" },
      createdAt: "2026-11-11T16:06:33Z",
      updatedAt: "2026-11-11T16:11:45Z",
      url: "https://github.com/o/r/issues/59",
      body: "  Long body   with spaces.  ",
    },
    {
      number: 12,
      title: "",
      state: "CLOSED",
      labels: [],
      assignees: [],
      milestone: null,
      createdAt: "2026-11-11T15:00:00Z",
      updatedAt: "2026-11-11T15:00:00Z",
      url: "https://github.com/o/r/issues/12",
      body: "",
    },
  ]);
}

function issuesRunner(issueList: RunResult): Runner {
  return async (_command: string, args: string[]) => {
    if (args.includes("issue") && args.includes("list")) return issueList;
    return okResult("[]");
  };
}

test("readGitHubIssues: parses issue cards with field/label mapping", async () => {
  const read = await readGitHubIssues({ noGh: false }, issuesRunner(okResult(issueJson())));
  assert.equal(read.unavailable, false);
  assert.equal(read.issues.length, 2);
  const first = read.issues[0];
  assert.ok(first);
  assert.equal(first.number, 59);
  assert.equal(first.title, "Factory-control: bidirectional GitHub issue sync");
  assert.equal(first.state, "open"); // normalized from “OPEN”
  assert.equal(first.labels.type, "feature");
  assert.deepEqual(first.labels.role, ["builder"]);
  assert.equal(first.labels.status, "spec");
  assert.equal(first.labels.blocked, true);
  assert.deepEqual(first.assignees, ["alice", "bob"]);
  assert.equal(first.milestone, "M0");
  assert.equal(first.createdAt, "2026-11-11T16:06:33Z");
  assert.equal(first.updatedAt, "2026-11-11T16:11:45Z");
  assert.equal(first.url, "https://github.com/o/r/issues/59");
  assert.equal(first.bodyExcerpt, "Long body with spaces.");
  // Malformed record (missing title) → retained with state unknown + error entry.
  const second = read.issues[1];
  assert.ok(second);
  assert.equal(second.number, 12);
  assert.equal(second.state, "unknown");
  assert.ok(read.errors.some((e) => e.includes("record #12 parse failed")));
});

test("readGitHubIssues: non-object record retained with state unknown + error entry", async () => {
  const payload = JSON.stringify([
    { number: 1, title: "ok", state: "open", labels: [], assignees: [], milestone: null, url: "u", body: "" },
    42,
  ]);
  const read = await readGitHubIssues({ noGh: false }, issuesRunner(okResult(payload)));
  assert.equal(read.issues.length, 2);
  assert.equal(read.issues[0]?.state, "open");
  assert.equal(read.issues[1]?.state, "unknown");
  assert.ok(read.errors.some((e) => e.includes("record is not an object")));
});

test("readGitHubIssues: gh failure → unavailable + errors entry", async () => {
  const read = await readGitHubIssues({ noGh: false }, issuesRunner(failResult("gh: not logged in\n")));
  assert.equal(read.unavailable, true);
  assert.deepEqual(read.issues, []);
  assert.ok(read.errors.some((e) => e.includes("gh unavailable")));
});

test("readGitHubIssues: invalid JSON → not unavailable, errors entry", async () => {
  const read = await readGitHubIssues({ noGh: false }, issuesRunner(okResult("not json")));
  assert.equal(read.unavailable, false);
  assert.deepEqual(read.issues, []);
  assert.ok(read.errors.some((e) => e.includes("invalid JSON")));
});

test("readGitHubIssues: noGh → unavailable without invoking gh", async () => {
  const read = await readGitHubIssues({ noGh: true });
  assert.equal(read.unavailable, true);
  assert.deepEqual(read.issues, []);
});

test("parseIssueCard: malformed required fields force state unknown", () => {
  const parsed = parseIssueCard({ number: "nope", title: "", state: "open", labels: [], assignees: [], milestone: null, url: "u", body: "" });
  assert.equal(parsed.card.state, "unknown");
  assert.ok(parsed.error);
});
