/**
 * M4 dispatch/skill trigger types.
 *
 * The queue is operator-driven: the control server never spawns agents. It
 * only records structured requests (JSONL) that the Lead session picks up and
 * dispatches via its standard delegation tools. Entries transition
 * `queued → dispatched → done/cancelled`; the server may mark `dispatched` /
 * `done` from snapshot evidence (live agent match; handoff present).
 */

export type DispatchStatus = "queued" | "dispatched" | "done" | "cancelled";

export const DISPATCH_STATUSES: readonly DispatchStatus[] = [
  "queued",
  "dispatched",
  "done",
  "cancelled",
];

/** A queue entry (the persisted JSONL shape). */
export interface DispatchEntry {
  id: string;
  at: string;
  unit: string;
  specPath?: string;
  /** Branch name for the delegation worktree (e.g. `factory/<unit>`). */
  worktree?: string;
  /** Suggested agent definition only — the Lead decides. */
  role?: string;
  acceptance?: string;
  /** Skill trigger id when this entry is a skill request. */
  skill?: string;
  /** Unit/skill context references for the delegated agent. */
  contextRefs?: string[];
  status: DispatchStatus;
}

/** The plan `POST /api/dispatch/prepare` returns for a dispatch/skill request. */
export interface DispatchPlan {
  kind: "dispatch" | "skill";
  unit: string;
  role: string;
  worktree: string;
  /** Computed physical worktree path (hint; actual path may differ). */
  worktreePath?: string;
  specPath?: string;
  skill?: string;
  skillPath?: string;
  contextRefs?: string[];
  acceptance: string;
  summary: string;
  delegationPrompt: string;
}

export interface DispatchPrepareRequest {
  unit?: unknown;
  skill?: unknown;
}

export interface PrepareMeta {
  operator?: string;
  ip?: string;
}
