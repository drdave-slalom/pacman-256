/**
 * M2 gate preconditions.
 *
 * Each action declares a precondition list evaluated against the snapshot —
 * never trusted from the caller. Failures are returned as 409 with explicit
 * reasons. The functions here are pure over a snapshot (plus the request's
 * unit/pr/override/root inputs) so they are unit-testable with fixtures.
 */

import { existsSync } from "node:fs";
import { canonicalId } from "../canonical.ts";
import type { AgentRecord, FactorySnapshot, Unit } from "../types.ts";
import { deriveIssueUnitId, issueSpecPath } from "./issue-work.ts";
import type { ActionContext, Precondition } from "./types.ts";

const ACTING_STATES = new Set(["working", "blocked", "settling", "starting"]);

/** A live agent is one that is currently acting on a unit. */
export function isActingAgent(agent: AgentRecord): boolean {
  return ACTING_STATES.has(agent.state);
}

/**
 * Resolve the unit an action targets: by canonical id, or — when only a PR
 * number is given — by the unit whose PR number matches.
 */
export function resolveUnit(
  snapshot: FactorySnapshot,
  unitId?: string,
  prNumber?: number,
): Unit | undefined {
  if (unitId !== undefined) {
    const canon = canonicalId(unitId);
    return snapshot.units.find((unit) => unit.id === canon);
  }
  if (prNumber !== undefined) {
    return snapshot.units.find((unit) => unit.pr?.number === prNumber);
  }
  return undefined;
}

function ok(name: string, detail: string): Precondition {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): Precondition {
  return { name, ok: false, detail };
}

function hasReviewHandoff(unit: Unit): boolean {
  return unit.handoffs.some((handoff) => handoff.definition?.toLowerCase() === "pr-reviewer");
}

function hasQaHandoff(unit: Unit): boolean {
  return unit.handoffs.some((handoff) => handoff.definition?.toLowerCase() === "qa-tester");
}

/** A `factory/<unit>` branch exists in the snapshot (attached or orphaned). */
function branchExistsForUnit(snapshot: FactorySnapshot, unit: Unit): boolean {
  if (unit.branch !== undefined) return true;
  return snapshot.orphaned.branches.some((branch) => canonicalId(branch) === unit.id);
}

function mergedAndGreen(unit: Unit): boolean {
  return (
    unit.pr !== undefined &&
    unit.pr.state.toUpperCase() === "MERGED" &&
    unit.pr.checks === "green"
  );
}

function unitFoundGuard(unit: Unit | undefined): Precondition {
  if (unit !== undefined) {
    return ok("unit-found", `unit ${unit.id} found in snapshot`);
  }
  return fail("unit-found", "no such unit in the snapshot");
}

function noLiveAgentGuard(unit: Unit | undefined): Precondition {
  if (unit !== undefined && unit.agents.some(isActingAgent)) {
    return fail("no-live-agent", "a live agent is still acting on this unit");
  }
  return ok("no-live-agent", "no live agent acting on this unit");
}

function issuePresentGuard(unit: Unit | undefined): Precondition {
  if (
    unit !== undefined &&
    unit.issue !== undefined &&
    Number.isInteger(unit.issue.number) &&
    unit.issue.number > 0
  ) {
    return ok("issue-present", `issue #${unit.issue.number} present on unit ${unit.id}`);
  }
  return fail("issue-present", "unit does not carry a valid GitHub issue (IssueCard)");
}

/** Fail when the snapshot's GitHub read is unavailable (gh missing or failed). */
function ghAvailableGuard(snapshot: FactorySnapshot): Precondition {
  const unavailable = snapshot.errors.some((error) => /^gh unavailable:/i.test(error));
  if (unavailable) {
    return fail("gh-available", "GitHub read unavailable in snapshot (gh failed or missing); refusing GitHub write-back");
  }
  return ok("gh-available", "GitHub read available in snapshot");
}

/** Any attached or orphaned branch whose canonical id matches `id`. */
function branchExistsForId(snapshot: FactorySnapshot, id: string): boolean {
  const canon = canonicalId(id);
  if (snapshot.units.some((unit) => unit.branch !== undefined && canonicalId(unit.branch) === canon)) {
    return true;
  }
  return snapshot.orphaned.branches.some((branch) => canonicalId(branch) === canon);
}

/** Guards for the GitHub write-back actions (U4): issue + no live agent + gh available. */
function issueActionGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(issuePresentGuard(unit));
  guards.push(noLiveAgentGuard(unit));
  guards.push(ghAvailableGuard(ctx.snapshot));
  return guards;
}

/** Guards for `factory/start-work` (U5): issue, gh available, no live agent, no existing spec/branch for the derived id. */
function startWorkGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(issuePresentGuard(unit));
  guards.push(ghAvailableGuard(ctx.snapshot));
  guards.push(noLiveAgentGuard(unit));

  const issue = unit.issue;
  const id = issue !== undefined ? deriveIssueUnitId(issue) : "";
  const specPath = issue !== undefined ? issueSpecPath(issue) : "";

  if (unit.specPath !== undefined) {
    guards.push(fail("no-spec", `unit ${unit.id} already has a SPEC at ${unit.specPath}`));
  } else if (specPath !== "" && ctx.snapshot.units.some((candidate) => candidate.specPath === specPath)) {
    guards.push(fail("no-spec", `a spec already exists at ${specPath}`));
  } else {
    guards.push(ok("no-spec", specPath !== "" ? `no spec at ${specPath}` : "no existing spec for the derived unit"));
  }

  if (unit.branch !== undefined) {
    guards.push(fail("no-branch", `unit ${unit.id} already has branch ${unit.branch}`));
  } else if (id !== "" && branchExistsForId(ctx.snapshot, id)) {
    guards.push(fail("no-branch", `a factory/${id} branch already exists`));
  } else {
    guards.push(ok("no-branch", id !== "" ? `no factory/${id} branch exists` : "no existing branch for the derived unit"));
  }

  return guards;
}

function worktreeCreateGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(
    unit.specPath !== undefined
      ? ok("spec-exists", "unit has a SPEC file")
      : fail("spec-exists", "unit has no SPEC file in the snapshot"),
  );
  guards.push(
    !branchExistsForUnit(ctx.snapshot, unit)
      ? ok("no-branch", `no factory/${unit.id} branch exists`)
      : fail("no-branch", `a factory/${unit.id} branch already exists`),
  );
  guards.push(
    unit.worktree === undefined
      ? ok("no-worktree", `no worktree exists for ${unit.id}`)
      : fail("no-worktree", `a worktree already exists: ${unit.worktree.path}`),
  );
  guards.push(noLiveAgentGuard(unit));
  return guards;
}

function worktreeRemoveGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(noLiveAgentGuard(unit));
  if (ctx.override) {
    guards.push(ok("merged-or-override", "override requested; merged+green waived"));
  } else if (mergedAndGreen(unit)) {
    guards.push(ok("merged-or-override", "PR merged and CI green"));
  } else {
    const state = unit.pr?.state.toUpperCase() ?? "none";
    const checks = unit.pr?.checks ?? "unavailable";
    guards.push(
      fail(
        "merged-or-override",
        `PR state=${state}, checks=${checks}; must be merged+green, or pass override:true to force`,
      ),
    );
  }
  return guards;
}

function checksRunGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  const worktreePath = unit.worktree?.path;
  const worktreeOnDisk = worktreePath !== undefined && existsSync(worktreePath);
  if (worktreeOnDisk) {
    guards.push(ok("worktree-or-root", `worktree exists: ${worktreePath}`));
  } else if (ctx.root) {
    guards.push(ok("worktree-or-root", "no worktree; running at repo root (root flag)"));
  } else {
    guards.push(
      fail("worktree-or-root", "no worktree for this unit; pass root:true to run at the repo root"),
    );
  }
  guards.push(
    worktreeOnDisk && ctx.root
      ? fail("not-root-when-worktree", "a worktree exists; refusing to run on the primary checkout")
      : ok("not-root-when-worktree", "run location is safe"),
  );
  return guards;
}

function prOpenGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(
    branchExistsForUnit(ctx.snapshot, unit)
      ? ok("branch-exists", `branch exists for ${unit.id}`)
      : fail("branch-exists", `no factory/${unit.id} branch exists yet`),
  );
  guards.push(
    hasReviewHandoff(unit)
      ? ok("review-handoff", "review handoff present (pr-reviewer)")
      : fail("review-handoff", "review handoff missing (pr-reviewer)"),
  );
  guards.push(
    hasQaHandoff(unit)
      ? ok("qa-handoff", "QA handoff present (qa-tester)")
      : fail("qa-handoff", "QA handoff missing (qa-tester)"),
  );
  return guards;
}

function checksQueryGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  const hasPr =
    unit.pr !== undefined ||
    (ctx.prNumber !== undefined &&
      ctx.snapshot.prs.some((pr) => pr.number === ctx.prNumber));
  guards.push(
    hasPr
      ? ok("pr-exists", hasPr && unit.pr !== undefined ? `PR #${unit.pr.number} exists` : "PR exists")
      : fail("pr-exists", "no PR found for this unit"),
  );
  return guards;
}

function prMergeGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(
    unit.pr !== undefined && unit.pr.state.toUpperCase() === "OPEN"
      ? ok("pr-open", `PR #${unit.pr.number} is open`)
      : fail("pr-open", `PR state is ${unit.pr?.state.toUpperCase() ?? "none"}; expected OPEN`),
  );
  guards.push(
    unit.pr?.checks === "green"
      ? ok("checks-green", "checks green")
      : fail("checks-green", `checks are ${unit.pr?.checks ?? "unavailable"}; expected green`),
  );
  guards.push(
    hasReviewHandoff(unit)
      ? ok("review-handoff", "review handoff present (pr-reviewer)")
      : fail("review-handoff", "review handoff missing (pr-reviewer)"),
  );
  guards.push(
    hasQaHandoff(unit)
      ? ok("qa-handoff", "QA handoff present (qa-tester)")
      : fail("qa-handoff", "QA handoff missing (qa-tester)"),
  );
  return guards;
}

function mainMergeGuards(ctx: ActionContext, unit: Unit | undefined): Precondition[] {
  const guards: Precondition[] = [unitFoundGuard(unit)];
  if (unit === undefined) return guards;
  guards.push(
    ctx.override
      ? ok("override-required", "explicit user approval recorded (override:true)")
      : fail("override-required", "direct merge into main requires override:true (explicit user approval)"),
  );
  guards.push(
    unit.pr !== undefined && unit.pr.checks === "green"
      ? ok("branch-ci-green", `CI green on the branch (PR #${unit.pr.number})`)
      : fail("branch-ci-green", `no green CI found for ${unit.id} (PR checks ${unit.pr?.checks ?? "none"})`),
  );
  guards.push(
    hasReviewHandoff(unit)
      ? ok("review-handoff", "review handoff present (pr-reviewer)")
      : fail("review-handoff", "review handoff missing (pr-reviewer)"),
  );
  guards.push(
    hasQaHandoff(unit)
      ? ok("qa-handoff", "QA handoff present (qa-tester)")
      : fail("qa-handoff", "QA handoff missing (qa-tester)"),
  );
  return guards;
}

/** Evaluate the precondition list for an action. */
export function guardFor(action: string, ctx: ActionContext): Precondition[] {
  const unit = resolveUnit(ctx.snapshot, ctx.unitId, ctx.prNumber);
  switch (action) {
    case "worktree/create":
      return worktreeCreateGuards(ctx, unit);
    case "worktree/remove":
      return worktreeRemoveGuards(ctx, unit);
    case "checks/run":
      return checksRunGuards(ctx, unit);
    case "pr/open":
      return prOpenGuards(ctx, unit);
    case "checks/query":
      return checksQueryGuards(ctx, unit);
    case "pr/merge":
      return prMergeGuards(ctx, unit);
    case "main/merge":
      return mainMergeGuards(ctx, unit);
    case "github/issue-comment":
    case "github/issue-label":
    case "github/issue-state":
      return issueActionGuards(ctx, unit);
    case "factory/start-work":
      return startWorkGuards(ctx, unit);
    default:
      return [fail("action", `unknown action: ${action}`)];
  }
}

/** True when every precondition passes. */
export function preconditionsPass(preconditions: Precondition[]): boolean {
  return preconditions.every((precondition) => precondition.ok);
}
