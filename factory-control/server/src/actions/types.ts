/**
 * M2 guarded-actions shared types.
 *
 * The action API is the only surface that mutates git/GitHub/scripts. Every
 * action is two-step: `prepare` (computes gate preconditions from the snapshot
 * and returns a plan) → `execute` (operator confirms; preconditions are
 * re-evaluated against a fresh snapshot before anything runs).
 */

import type { FactorySnapshot } from "../types.ts";

/** A single gate precondition result. */
export interface Precondition {
  name: string;
  ok: boolean;
  detail: string;
}

/** A single subprocess to execute (argv, not a shell string). */
export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

/** A file-write action step (executed in-process at the factory root). */
export interface WriteStep {
  kind: "write";
  /** Repo-relative destination path (e.g. `SPEC/fc-x.md`). */
  path: string;
  content: string;
}

/** An M4 dispatch-enqueue action step (via the injected dispatch service). */
export interface DispatchStep {
  kind: "dispatch";
  /** The issue-card unit the action targeted (snapshot sanity check). */
  sourceUnit: string;
  /** Derived factory unit id being created. */
  unit: string;
  specPath: string;
  worktree: string;
  role: string;
  acceptance: string;
}

/** One executable step of an action: subprocess command, file write, or dispatch enqueue. */
export type ActionStep = CommandSpec | WriteStep | DispatchStep;

/** A plan step shown to the operator before confirmation. */
export interface PlanStep {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ActionPlan {
  summary: string;
  steps: PlanStep[];
  /** Planned file writes shown before confirmation (start-work scaffold). */
  files?: { path: string; summary: string }[];
  /** Delegation prompt preview (start-work) ready for the Lead to copy. */
  prompt?: string;
}

/** Everything a guard/plan/step builder needs to derive its behavior. */
export interface ActionContext {
  snapshot: FactorySnapshot;
  unitId?: string;
  prNumber?: number;
  override: boolean;
  root: boolean;
  /** github/issue-comment body text (required for that action). */
  comment?: string;
  /** github/issue-label labels to add (optional). */
  addLabels?: string[];
  /** github/issue-label labels to remove (optional). */
  removeLabels?: string[];
  /** github/issue-state: "close" | "reopen" (default close). */
  issueState?: "close" | "reopen";
}

export interface ActionResult {
  requestId: string;
  outcome: "success" | "failed";
  /** Executed command lines (argv joined). */
  command: string[];
  /** Exit status of the first failing step, or 0 on success. */
  exit: number | null;
  outputTail: string;
  /** Delegation prompt returned by a dispatch-enqueue step (start-work). */
  prompt?: string;
}

export interface PrepareRequest {
  unit?: string;
  pr?: number;
  override?: boolean;
  /** checks/run only: run at the repo root when the unit has no worktree. */
  root?: boolean;
  operator?: string;
  /** github/issue-comment: comment body text. */
  comment?: unknown;
  /** github/issue-label: labels to add (array of label strings). */
  addLabels?: unknown;
  /** github/issue-label: labels to remove (array of label strings). */
  removeLabels?: unknown;
  /** github/issue-state: "close" | "reopen" (default close). */
  state?: unknown;
}

export interface ExecuteRequest {
  requestId: string;
  confirm?: boolean;
  approvedBy?: string;
  operator?: string;
}

export interface PrepareMeta {
  ip?: string;
  operator?: string;
}

export interface ExecuteMeta {
  ip?: string;
}
