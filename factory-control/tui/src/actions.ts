/**
 * Action-menu derivation for the factory-control TUI.
 *
 * Candidate actions are derived purely from a unit's flags/stage (mirroring
 * the M2 action registry's intent). Actual availability is decided by the M2
 * server: the screen calls `prepare` for every candidate and only accepted
 * actions become runnable; rejected ones display their exact guard reasons.
 */

import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";
import type { DispatchPlanLike } from "./api.ts";
import type { TriggerCandidate } from "./triggers.ts";

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

export type MenuPlan = PlanLike | DispatchPlanLike;

export type IssueInputKind = "comment" | "labels" | "state";

export interface ActionCandidate {
  name: string;
  label: string;
  hint: string;
  /** Issue write-back actions require operator input before prepare/execute. */
  input?: IssueInputKind;
}

const CATALOG: Readonly<Record<string, { label: string; hint: string }>> = {
  "worktree/create": { label: "Create worktree", hint: "worktree + factory/<unit> branch" },
  "worktree/remove": { label: "Remove worktree", hint: "remove worktree + branch" },
  "checks/run": { label: "Run checks", hint: "npm run check in the worktree" },
  "pr/open": { label: "Open PR", hint: "open PR factory/<unit> → main" },
  "checks/query": { label: "Query PR checks", hint: "poll gh pr checks" },
  "pr/merge": { label: "Merge PR", hint: "gh pr merge --merge" },
  "main/merge": { label: "Direct main merge", hint: "requires override:true approval" },
  "github/issue-comment": { label: "Comment on issue", hint: "write a comment on the issue" },
  "github/issue-label": { label: "Change issue labels", hint: "add/remove labels (comma-separated)" },
  "github/issue-state": { label: "Close / reopen issue", hint: "switch issue state (close/reopen)" },
  "factory/start-work": { label: "Start work", hint: "scaffold spec + branch + enqueue dispatch" },
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

  // Issue write-back + start-work actions appear on issue-seeded/hybrid cards.
  // Availability is decided by the M2/M4 prepare preconditions (gh auth, issue
  // state, existing branch/worktree); comment/label/state require operator
  // input on open, so they are not eagerly prepared with a neutral body.
  if (unit.issue !== undefined) {
    out.push({ ...cat("github/issue-comment"), input: "comment" });
    out.push({ ...cat("github/issue-label"), input: "labels" });
    out.push({ ...cat("github/issue-state"), input: "state" });
    out.push(cat("factory/start-work"));
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
  plan?: MenuPlan;
  /** `action` (M2) | `dispatch` | `skill` (M4 triggers). */
  kind?: "action" | "dispatch" | "skill";
  skill?: string;
  /** Issue write-back actions ask for operator input before prepare. */
  input?: IssueInputKind;
}

export interface PreparedOutcome {
  ok: boolean;
  preconditions: PreconditionLike[];
  plan?: MenuPlan;
}

function reasonLines(preconditions: PreconditionLike[]): string[] {
  return preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`);
}

export type MenuCandidate = ActionCandidate | TriggerCandidate;

function isTrigger(c: MenuCandidate): c is TriggerCandidate {
  return "kind" in c && (c.kind === "dispatch" || c.kind === "skill");
}

/** Build menu rows from prepare outcomes (ok/reasons per row). */
export function buildActionMenu(
  candidates: readonly MenuCandidate[],
  prepared: ReadonlyMap<string, PreparedOutcome>,
): ActionMenuRow[] {
  return candidates.map((c) => {
    const outcome = prepared.get(c.name);
    // Input-requiring rows are always openable: guards are evaluated with the
    // operator-supplied body at prepare time when the row is opened.
    const input = "input" in c ? c.input : undefined;
    const ok = input !== undefined ? true : (outcome?.ok ?? false);
    const row: ActionMenuRow = {
      name: c.name,
      label: c.label,
      hint: c.hint,
      ok,
      reasons: input !== undefined ? [] : (outcome !== undefined ? reasonLines(outcome.preconditions) : ["not prepared"]),
      preconditions: outcome?.preconditions ?? [],
      kind: isTrigger(c) ? c.kind : "action",
    };
    if (input !== undefined) row.input = input;
    if (isTrigger(c) && c.skill !== undefined) row.skill = c.skill;
    if (outcome?.plan !== undefined) row.plan = outcome.plan;
    return row;
  });
}
