/**
 * Action-menu derivation for the factory-control TUI.
 *
 * Candidate actions are derived purely from a unit's flags/stage (mirroring
 * the M2 action registry's intent). Actual availability is decided by the M2
 * server: the screen calls `prepare` for every candidate and only accepted
 * actions become runnable; rejected ones display their exact guard reasons.
 */

import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";

/** Structural mirrors of the M2 API shapes (server's own types are not shared). */
export interface PreconditionLike {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PlanStepLike {
  command: string;
  args: string[];
  cwd?: string;
}

export interface PlanLike {
  summary: string;
  steps: PlanStepLike[];
}

export interface ActionCandidate {
  name: string;
  label: string;
  hint: string;
}

const CATALOG: Readonly<Record<string, { label: string; hint: string }>> = {
  "worktree/create": { label: "Create worktree", hint: "worktree + factory/<unit> branch" },
  "worktree/remove": { label: "Remove worktree", hint: "remove worktree + branch" },
  "checks/run": { label: "Run checks", hint: "npm run check in the worktree" },
  "pr/open": { label: "Open PR", hint: "open PR factory/<unit> → main" },
  "checks/query": { label: "Query PR checks", hint: "poll gh pr checks" },
  "pr/merge": { label: "Merge PR", hint: "gh pr merge --merge" },
  "main/merge": { label: "Direct main merge", hint: "requires override:true approval" },
};

function cat(name: string): ActionCandidate {
  const meta = CATALOG[name];
  if (meta === undefined) throw new Error(`unknown action catalog entry: ${name}`);
  return { name, label: meta.label, hint: meta.hint };
}

function branchExistsForUnit(unit: Unit, snapshot: FactorySnapshot): boolean {
  if (unit.branch !== undefined) return true;
  const id = unit.id.toLowerCase();
  return snapshot.orphaned.branches.some((b) => b.toLowerCase().endsWith(`/${id}`));
}

/**
 * Derive candidate actions for a unit from its snapshot-derived flags/stage.
 * Ordered roughly by the factory pipeline. Availability is confirmed later by
 * M2 `prepare` results.
 */
export function candidateActions(unit: Unit, snapshot: FactorySnapshot): ActionCandidate[] {
  const out: ActionCandidate[] = [];
  const stage = unit.stage;
  const branchExists = branchExistsForUnit(unit, snapshot);

  if (unit.specPath !== undefined && unit.worktree === undefined && !branchExists) {
    out.push(cat("worktree/create"));
  }
  if (unit.worktree !== undefined || unit.flags.readyForCleanup) {
    out.push(cat("worktree/remove"));
  }
  if (
    unit.worktree !== undefined ||
    stage === "execute" ||
    stage === "review" ||
    stage === "qa" ||
    stage === "integrate" ||
    stage === "ci"
  ) {
    out.push(cat("checks/run"));
  }
  if (branchExists && unit.pr === undefined) {
    out.push(cat("pr/open"));
  }
  if (unit.pr !== undefined) {
    out.push(cat("checks/query"));
  }
  if (unit.pr !== undefined && String(unit.pr.state).toUpperCase() === "OPEN") {
    out.push(cat("pr/merge"));
  }
  if ((unit.pr !== undefined && unit.pr.checks === "green") || unit.flags.readyToMerge) {
    out.push(cat("main/merge"));
  }
  return out;
}

export interface ActionMenuRow {
  name: string;
  label: string;
  hint: string;
  ok: boolean;
  reasons: string[];
  preconditions: PreconditionLike[];
  plan?: PlanLike;
}

export interface PreparedOutcome {
  ok: boolean;
  preconditions: PreconditionLike[];
  plan?: PlanLike;
}

function reasonLines(preconditions: PreconditionLike[]): string[] {
  return preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`);
}

/** Build menu rows from prepare outcomes (ok/reasons per row). */
export function buildActionMenu(
  candidates: ActionCandidate[],
  prepared: ReadonlyMap<string, PreparedOutcome>,
): ActionMenuRow[] {
  return candidates.map((c) => {
    const outcome = prepared.get(c.name);
    const ok = outcome?.ok ?? false;
    const row: ActionMenuRow = {
      name: c.name,
      label: c.label,
      hint: c.hint,
      ok,
      reasons: outcome !== undefined ? reasonLines(outcome.preconditions) : ["not prepared"],
      preconditions: outcome?.preconditions ?? [],
    };
    if (outcome?.plan !== undefined) row.plan = outcome.plan;
    return row;
  });
}
