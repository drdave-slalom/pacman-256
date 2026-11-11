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

/** A plan step shown to the operator before confirmation. */
export interface PlanStep {
  command: string;
  args: string[];
  cwd?: string;
}

export interface ActionPlan {
  summary: string;
  steps: PlanStep[];
}

/** Everything a guard/plan/step builder needs to derive its behavior. */
export interface ActionContext {
  snapshot: FactorySnapshot;
  unitId?: string;
  prNumber?: number;
  override: boolean;
  root: boolean;
}

export interface ActionResult {
  requestId: string;
  outcome: "success" | "failed";
  /** Executed command lines (argv joined). */
  command: string[];
  /** Exit status of the first failing step, or 0 on success. */
  exit: number | null;
  outputTail: string;
}

export interface PrepareRequest {
  unit?: string;
  pr?: number;
  override?: boolean;
  /** checks/run only: run at the repo root when the unit has no worktree. */
  root?: boolean;
  operator?: string;
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
