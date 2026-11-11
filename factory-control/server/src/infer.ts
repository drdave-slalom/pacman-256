import type { Attention, CheckState, IssueCard, Stage, UnitFlags } from "./types.ts";

/**
 * Pure-inference stage decision (spec: "Pure-inference stage decision").
 *
 * Evidence is collected per unit; the first matching rule (evaluated top-down
 * per the spec) wins. `unknown` only when no rule matches.
 */

export interface Evidence {
  hasSpec: boolean;
  hasWorktree: boolean;
  hasBranch: boolean;
  /** Implementation handoff present (definition in {builder, implementer, generalist}). */
  hasImpl: boolean;
  /** Review handoff present (definition `pr-reviewer`). */
  hasReview: boolean;
  /** QA handoff present (definition `qa-tester`). */
  hasQa: boolean;
  prState?: "OPEN" | "MERGED" | "CLOSED";
  checks?: CheckState;
  /** A live agent is currently acting on this unit (step 7). */
  liveAgentActing: boolean;
  blockedAgent: boolean;
}

export interface Inferred {
  stage: Stage;
  flags: UnitFlags;
  attention: Attention[];
}

const IMPLEMENTATION_DEFINITIONS = new Set(["builder", "implementer", "generalist"]);

export function isImplementationDefinition(definition: string | undefined): boolean {
  return definition !== undefined && IMPLEMENTATION_DEFINITIONS.has(definition.toLowerCase());
}

function emptyFlags(): UnitFlags {
  return {
    reviewPending: false,
    qaPending: false,
    ciRed: false,
    readyToMerge: false,
    readyForCleanup: false,
    needsDispatch: false,
    blockedAgent: false,
  };
}

function attentionFromFlags(flags: UnitFlags): Attention[] {
  const attention: Attention[] = [];
  if (flags.blockedAgent) attention.push("blocked-agent");
  if (flags.reviewPending) attention.push("review-pending");
  if (flags.qaPending) attention.push("qa-pending");
  if (flags.ciRed) attention.push("ci-red");
  if (flags.readyToMerge) attention.push("ready-to-merge");
  if (flags.readyForCleanup) attention.push("ready-for-cleanup");
  if (flags.needsDispatch) attention.push("needs-dispatch");
  return attention;
}

export function inferUnit(evidence: Evidence): Inferred {
  const flags = emptyFlags();
  flags.blockedAgent = evidence.blockedAgent;

  const hasWork = evidence.hasWorktree || evidence.hasBranch;

  let stage: Stage;

  if (evidence.prState === "MERGED") {
    stage = "done";
    flags.readyForCleanup = hasWork;
  } else if (evidence.prState === "OPEN" && evidence.checks === "green") {
    stage = "integrate";
    flags.readyToMerge = true;
  } else if (evidence.prState === "OPEN") {
    stage = "integrate";
    flags.ciRed = evidence.checks === "red";
  } else if (hasWork && evidence.hasImpl && evidence.hasReview && evidence.hasQa) {
    stage = "integrate";
  } else if (hasWork && evidence.hasImpl && evidence.hasReview) {
    stage = "qa";
    flags.qaPending = true;
  } else if (hasWork && evidence.hasImpl) {
    stage = "review";
    flags.reviewPending = true;
  } else if (hasWork && !evidence.hasImpl && evidence.liveAgentActing) {
    stage = "execute";
  } else if (hasWork) {
    stage = "dispatch";
  } else if (evidence.hasSpec) {
    stage = "spec";
    flags.needsDispatch = true;
  } else {
    stage = "unknown";
  }

  const attention = attentionFromFlags(flags);
  return { stage, flags, attention };
}

export interface IssueEvidence {
  hasBranch: boolean;
  hasWorktree: boolean;
  /** A live agent is currently acting on this unit. */
  liveAgentActing: boolean;
  blockedAgent: boolean;
  prState?: "OPEN" | "MERGED" | "CLOSED";
  checks?: CheckState;
}

/**
 * Stage/flag/attention inference for GitHub-issue card units (U3). Reuses the
 * existing spec-unit machinery for artifact/PR effects, then overlays the
 * issue's `status:*` label rules:
 *
 * - `status:spec` → stage spec
 * - `status:ready` → stage spec + needsDispatch
 * - `status:in-progress` → execute (review when an open PR exists)
 * - `status:review` → review + reviewPending
 * - no status → spec + needsDispatch when no artifact exists (mirrors rule 9)
 *
 * A `blocked` label surfaces via the existing `parse-error` attention (no new
 * enumeration); `blocked-agent` is reserved for live blocked agents.
 */
export function inferIssueUnit(card: IssueCard, evidence: IssueEvidence): Inferred {
  const base = inferUnit({
    hasSpec: true,
    hasWorktree: evidence.hasWorktree,
    hasBranch: evidence.hasBranch,
    hasImpl: false,
    hasReview: false,
    hasQa: false,
    liveAgentActing: evidence.liveAgentActing,
    blockedAgent: evidence.blockedAgent,
    ...(evidence.prState !== undefined ? { prState: evidence.prState } : {}),
    ...(evidence.checks !== undefined ? { checks: evidence.checks } : {}),
  });

  const status = (card.labels.status ?? "").toLowerCase();
  const flags = { ...base.flags };
  let stage = base.stage;

  if (status === "spec") {
    stage = "spec";
    flags.needsDispatch = false;
  } else if (status === "ready") {
    stage = "spec";
    flags.needsDispatch = true;
  } else if (status === "in-progress") {
    flags.needsDispatch = false;
    if (evidence.prState === "OPEN") {
      stage = "review";
      flags.reviewPending = true;
    } else if (evidence.prState !== "MERGED") {
      stage = "execute";
    }
    // merged PR → keep base (done)
  } else if (status === "review") {
    stage = "review";
    flags.reviewPending = true;
    flags.needsDispatch = false;
  }
  // any other/empty status → keep base inference.

  const attention = attentionFromFlags(flags);
  if (card.labels.blocked && !attention.includes("parse-error")) attention.push("parse-error");
  return { stage, flags, attention };
}
