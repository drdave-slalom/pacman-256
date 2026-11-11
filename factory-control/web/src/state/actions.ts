/**
 * Action-menu derivation for the factory-control web mirror.
 *
 * Candidate actions are derived purely from a unit's snapshot shape (kind,
 * issue link, worktree/branch state) — mirroring the M2 action registry's
 * intent and the TUI's menu pattern. Actual availability is decided by the
 * M2 server: the component calls `prepare` for every candidate and only
 * accepted actions become runnable; rejected ones display their exact guard
 * reasons (409 preconditions) verbatim.
 *
 * Pure — no React, no DOM, no I/O. Unit-testable against fixture snapshots.
 */

import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";

/** Structural mirrors of the M2 API shapes (the server's own types are not shared). */
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

/** Input form a row needs before the operator can confirm execution. */
export type ActionFormKind = "comment" | "labels" | "state";

export interface ActionCandidate {
  name: string;
  label: string;
  hint: string;
  form?: ActionFormKind;
}

const CATALOG: Readonly<Record<string, { label: string; hint: string; form?: ActionFormKind }>> = {
  "github/issue-comment": {
    label: "Comment on issue",
    hint: "post a comment to the GitHub issue",
    form: "comment",
  },
  "github/issue-label": {
    label: "Relabel issue",
    hint: "add/remove GitHub labels on the issue",
    form: "labels",
  },
  "github/issue-state": {
    label: "Close/reopen issue",
    hint: "set the GitHub issue state (open/closed)",
    form: "state",
  },
  "factory/start-work": {
    label: "Start work",
    hint: "scaffold spec + factory/<unit> branch/worktree + dispatch",
  },
};

function cat(name: string): ActionCandidate {
  const meta = CATALOG[name];
  if (meta === undefined) throw new Error(`unknown action catalog entry: ${name}`);
  const out: ActionCandidate = { name, label: meta.label, hint: meta.hint };
  if (meta.form !== undefined) out.form = meta.form;
  return out;
}

function branchExistsForUnit(unit: Unit, snapshot: FactorySnapshot): boolean {
  if (unit.branch !== undefined) return true;
  const id = unit.id.toLowerCase();
  return snapshot.orphaned.branches.some((b) => b.toLowerCase().endsWith(`/${id}`));
}

/**
 * Derive candidate actions for a unit from its snapshot shape. Issue-backed
 * units (issue-seeded or hybrid) always expose the GitHub write-back actions;
 * `factory/start-work` appears only while the issue has no branch/worktree yet
 * (the scaffold would create them). Non-issue units expose no actions here —
 * the existing M2 actions remain TUI surface (M3).
 */
export function candidateActions(unit: Unit, snapshot: FactorySnapshot): ActionCandidate[] {
  if (unit.issue === undefined) return [];
  const out: ActionCandidate[] = [
    cat("github/issue-comment"),
    cat("github/issue-label"),
    cat("github/issue-state"),
  ];
  if (unit.worktree === undefined && !branchExistsForUnit(unit, snapshot)) {
    out.push(cat("factory/start-work"));
  }
  return out;
}

export interface PreparedOutcome {
  ok: boolean;
  preconditions: PreconditionLike[];
  plan?: PlanLike;
  requestId?: string;
}

export interface ActionMenuRow {
  name: string;
  label: string;
  hint: string;
  form?: ActionFormKind;
  ok: boolean;
  reasons: string[];
  preconditions: PreconditionLike[];
  plan?: PlanLike;
  requestId?: string;
}

function reasonLines(preconditions: PreconditionLike[]): string[] {
  return preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`);
}

/**
 * Build menu rows from prepare outcomes (ok/reasons per row). A candidate with
 * no outcome yet is not runnable and reports `not prepared`.
 */
export function buildActionMenu(
  candidates: readonly ActionCandidate[],
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
    if (c.form !== undefined) row.form = c.form;
    if (outcome?.plan !== undefined) row.plan = outcome.plan;
    if (outcome?.requestId !== undefined) row.requestId = outcome.requestId;
    return row;
  });
}
