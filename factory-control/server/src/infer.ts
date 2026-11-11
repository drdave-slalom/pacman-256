import type { Attention, CheckState, Stage, UnitFlags } from "./types.ts";

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
