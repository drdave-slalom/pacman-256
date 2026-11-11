/**
 * M4 trigger-candidate derivation for the factory-control TUI.
 *
 * These are pure, display-level candidates ("Dispatch unit" on Spec-stage
 * cards; "Run skill…" on eligible cards). Real availability is decided by the
 * M4 server (dispatch prepare preconditions) — mirroring how the M2 action
 * menu works.
 */

import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";

export interface TriggerCandidate {
  kind: "dispatch" | "skill";
  /** Unique menu key: `dispatch` or `skill:<id>`. */
  name: string;
  /** Skill id when kind === "skill". */
  skill?: string;
  label: string;
  hint: string;
}

function hasBranch(unit: Unit, snapshot: FactorySnapshot): boolean {
  if (unit.branch !== undefined) return true;
  const id = unit.id.toLowerCase();
  return snapshot.orphaned.branches.some((b) => b.toLowerCase().endsWith(`/${id}`));
}

/**
 * Derive dispatch/skill trigger candidates for a unit. Eligibility mirrors the
 * server skill catalog and the dispatch gate (Spec-stage, no active writer).
 */
export function candidateTriggers(unit: Unit, snapshot: FactorySnapshot): TriggerCandidate[] {
  const out: TriggerCandidate[] = [];

  if (
    unit.stage === "spec" &&
    unit.specPath !== undefined &&
    unit.worktree === undefined &&
    !hasBranch(unit, snapshot)
  ) {
    out.push({
      kind: "dispatch",
      name: "dispatch",
      label: "Dispatch unit",
      hint: "enqueue a delegation request for the Lead",
    });
  }

  if (unit.specPath !== undefined) {
    if (unit.stage === "qa" || unit.flags.qaPending) {
      out.push({
        kind: "skill",
        name: "skill:qa-tester",
        skill: "qa-tester",
        label: "Run skill: qa-tester",
        hint: "QA verification in the worktree",
      });
    }
    if (unit.stage === "review" || unit.flags.reviewPending) {
      out.push({
        kind: "skill",
        name: "skill:pr-reviewer",
        skill: "pr-reviewer",
        label: "Run skill: pr-reviewer",
        hint: "read-only review of the diff",
      });
    }
    if (unit.pr === undefined && unit.branch !== undefined) {
      out.push({
        kind: "skill",
        name: "skill:open-pr",
        skill: "open-pr",
        label: "Run skill: open-pr",
        hint: "open PR factory/<unit> → main",
      });
    }
  }

  return out;
}
