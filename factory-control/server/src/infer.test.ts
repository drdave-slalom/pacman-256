import assert from "node:assert/strict";
import { test } from "node:test";
import { inferIssueUnit, inferUnit, isImplementationDefinition, type Evidence, type IssueEvidence } from "./infer.ts";
import type { IssueCard } from "./types.ts";

function evidence(partial: Partial<Evidence>): Evidence {
  return {
    hasSpec: true,
    hasWorktree: false,
    hasBranch: false,
    hasImpl: false,
    hasReview: false,
    hasQa: false,
    liveAgentActing: false,
    blockedAgent: false,
    ...partial,
  };
}

test("rule 1: merged PR without branch/worktree is done", () => {
  const out = inferUnit(evidence({ prState: "MERGED" }));
  assert.equal(out.stage, "done");
  assert.equal(out.flags.readyForCleanup, false);
});

test("rule 1b: merged PR with lingering worktree flags cleanup", () => {
  const out = inferUnit(evidence({ prState: "MERGED", hasWorktree: true }));
  assert.equal(out.stage, "done");
  assert.equal(out.flags.readyForCleanup, true);
  assert.ok(out.attention.includes("ready-for-cleanup"));
});

test("rule 2: open PR with green checks is integrate + readyToMerge", () => {
  const out = inferUnit(evidence({ prState: "OPEN", checks: "green", hasBranch: true }));
  assert.equal(out.stage, "integrate");
  assert.equal(out.flags.readyToMerge, true);
});

test("rule 3: open PR with red checks is integrate + ciRed", () => {
  const out = inferUnit(evidence({ prState: "OPEN", checks: "red" }));
  assert.equal(out.stage, "integrate");
  assert.equal(out.flags.ciRed, true);
  assert.ok(out.attention.includes("ci-red"));
});

test("rule 4: work + impl + review + qa is integrate (awaiting PR)", () => {
  const out = inferUnit(evidence({ hasWorktree: true, hasImpl: true, hasReview: true, hasQa: true }));
  assert.equal(out.stage, "integrate");
  assert.equal(out.flags.reviewPending, false);
  assert.equal(out.flags.qaPending, false);
});

test("rule 5: work + impl + review without qa is qa + qaPending", () => {
  const out = inferUnit(evidence({ hasBranch: true, hasImpl: true, hasReview: true }));
  assert.equal(out.stage, "qa");
  assert.equal(out.flags.qaPending, true);
});

test("rule 6: work + impl without review is review + reviewPending", () => {
  const out = inferUnit(evidence({ hasWorktree: true, hasImpl: true }));
  assert.equal(out.stage, "review");
  assert.equal(out.flags.reviewPending, true);
});

test("rule 7: work without impl but live agent acting is execute", () => {
  const out = inferUnit(evidence({ hasWorktree: true, liveAgentActing: true }));
  assert.equal(out.stage, "execute");
});

test("rule 8: work alone is dispatch", () => {
  const out = inferUnit(evidence({ hasBranch: true }));
  assert.equal(out.stage, "dispatch");
});

test("rule 9: spec alone is spec + needsDispatch", () => {
  const out = inferUnit(evidence({}));
  assert.equal(out.stage, "spec");
  assert.equal(out.flags.needsDispatch, true);
});

test("rule 10: no evidence at all is unknown", () => {
  const out = inferUnit(evidence({ hasSpec: false }));
  assert.equal(out.stage, "unknown");
});

test("blockedAgent flag and attention derive from agent states", () => {
  const out = inferUnit(evidence({ hasBranch: true, blockedAgent: true }));
  assert.equal(out.flags.blockedAgent, true);
  assert.ok(out.attention.includes("blocked-agent"));
});

test("isImplementationDefinition recognizes the implementation role set", () => {
  assert.equal(isImplementationDefinition("builder"), true);
  assert.equal(isImplementationDefinition("implementer"), true);
  assert.equal(isImplementationDefinition("generalist"), true);
  assert.equal(isImplementationDefinition("pr-reviewer"), false);
  assert.equal(isImplementationDefinition("qa-tester"), false);
  assert.equal(isImplementationDefinition(undefined), false);
});

function issueCard(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    number: 1,
    title: "Test issue",
    state: "open",
    url: "https://example.com/i/1",
    labels: { blocked: false, followUp: false, playtest: false, raw: [] },
    assignees: [],
    ...overrides,
  };
}

function issueEvidence(overrides: Partial<IssueEvidence> = {}): IssueEvidence {
  return {
    hasBranch: false,
    hasWorktree: false,
    liveAgentActing: false,
    blockedAgent: false,
    ...overrides,
  };
}

function labels(status?: string, blocked = false) {
  return { blocked, followUp: false, playtest: false, raw: [] as string[], ...(status ? { status } : {}) };
}

test("inferIssueUnit: status:spec → spec", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("spec") }), issueEvidence());
  assert.equal(out.stage, "spec");
  assert.equal(out.flags.needsDispatch, false);
});

test("inferIssueUnit: status:ready → spec + needsDispatch", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("ready") }), issueEvidence());
  assert.equal(out.stage, "spec");
  assert.equal(out.flags.needsDispatch, true);
  assert.ok(out.attention.includes("needs-dispatch"));
});

test("inferIssueUnit: status:in-progress → execute", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("in-progress") }), issueEvidence());
  assert.equal(out.stage, "execute");
});

test("inferIssueUnit: status:in-progress with open PR → review + reviewPending", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("in-progress") }), issueEvidence({ prState: "OPEN" }));
  assert.equal(out.stage, "review");
  assert.equal(out.flags.reviewPending, true);
  assert.ok(out.attention.includes("review-pending"));
});

test("inferIssueUnit: status:in-progress with merged PR → done (base)", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("in-progress") }), issueEvidence({ prState: "MERGED" }));
  assert.equal(out.stage, "done");
});

test("inferIssueUnit: status:review → review + reviewPending", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("review") }), issueEvidence());
  assert.equal(out.stage, "review");
  assert.equal(out.flags.reviewPending, true);
});

test("inferIssueUnit: no status without artifacts → spec + needsDispatch", () => {
  const out = inferIssueUnit(issueCard(), issueEvidence());
  assert.equal(out.stage, "spec");
  assert.equal(out.flags.needsDispatch, true);
  assert.ok(out.attention.includes("needs-dispatch"));
});

test("inferIssueUnit: no status with branch → dispatch (base artifact rule)", () => {
  const out = inferIssueUnit(issueCard(), issueEvidence({ hasBranch: true }));
  assert.equal(out.stage, "dispatch");
});

test("inferIssueUnit: blocked label surfaces via existing parse-error attention", () => {
  const out = inferIssueUnit(issueCard({ labels: labels(undefined, true) }), issueEvidence());
  assert.ok(out.attention.includes("parse-error"));
  assert.equal(out.flags.blockedAgent, false);
});

test("inferIssueUnit: blocked label + status:ready → both attentions", () => {
  const out = inferIssueUnit(issueCard({ labels: labels("ready", true) }), issueEvidence());
  assert.ok(out.attention.includes("needs-dispatch"));
  assert.ok(out.attention.includes("parse-error"));
});

test("inferIssueUnit: open PR with green checks → integrate + readyToMerge (base)", () => {
  const out = inferIssueUnit(issueCard(), issueEvidence({ prState: "OPEN", checks: "green" }));
  assert.equal(out.stage, "integrate");
  assert.equal(out.flags.readyToMerge, true);
});
