import { resolve } from "node:path";
import { bestMatch, canonicalId, tokensOf } from "./canonical.ts";
import { diffTotals, isDirty, listFactoryBranches, parseWorktrees, repoFacts, run } from "./git.ts";
import { readGitHub } from "./github.ts";
import { readHerdr } from "./herdr.ts";
import { inferUnit, isImplementationDefinition, type Evidence } from "./infer.ts";
import { findSpecFiles, readSpecUnit } from "./markdown.ts";
import type {
  AgentRecord,
  BranchFacts,
  DiffTotals,
  FactorySnapshot,
  HandoffRef,
  PullRequest,
  Unit,
  WorktreeFacts,
} from "./types.ts";

export interface SnapshotOptions {
  root: string;
  noGh: boolean;
}

const ACTING_STATES = new Set(["working", "blocked", "settling", "starting"]);

function isActing(agent: AgentRecord): boolean {
  return ACTING_STATES.has(agent.state);
}

function unitCanon(unit: Unit): string {
  return unit.id;
}

function unitTokens(unit: Unit): Set<string> {
  return tokensOf(unit.specPath ?? unit.id);
}

function attachBranches(
  units: Unit[],
  branches: BranchFacts[],
  diffByBranch: Map<string, DiffTotals>,
  orphaned: { branches: string[] },
): void {
  for (const branch of branches) {
    const match = bestMatch(branch.canonical, tokensOf(branch.name), units, unitCanon, unitTokens);
    if (match === undefined) {
      orphaned.branches.push(branch.name);
      continue;
    }
    if (match.value.branch === undefined) match.value.branch = branch.name;
    const diff = diffByBranch.get(branch.name);
    if (diff !== undefined && match.value.worktree) {
      match.value.worktree.diff = diff;
    }
  }
}

function attachWorktrees(
  units: Unit[],
  worktrees: WorktreeFacts[],
  diffByBranch: Map<string, DiffTotals>,
  orphaned: { worktrees: string[] },
  repoRoot: string,
): void {
  for (const worktree of worktrees) {
    const branchName = worktree.branch;
    // The primary checkout and non-factory worktrees are not factory artifacts.
    if (branchName === undefined || !branchName.startsWith("factory/")) continue;
    const match = bestMatch(canonicalId(branchName), tokensOf(branchName), units, unitCanon, unitTokens);
    if (match === undefined) {
      orphaned.worktrees.push(worktree.path);
      continue;
    }
    if (match.value.worktree !== undefined) continue;
    const diff = diffByBranch.get(branchName);
    match.value.worktree = {
      path: worktree.path,
      dirty: isDirty(worktree.path),
      ...(diff ? { diff } : {}),
    };
  }
}

function attachAgents(units: Unit[], agents: AgentRecord[]): void {
  for (const agent of agents) {
    const match = bestMatch(canonicalId(agent.label), tokensOf(agent.label), units, unitCanon, unitTokens);
    if (match !== undefined) match.value.agents.push(agent);
  }
}

function attachHandoffs(
  units: Unit[],
  handoffs: HandoffRef[],
  orphaned: { handoffs: HandoffRef[] },
): void {
  for (const handoff of handoffs) {
    const label = handoff.agent;
    if (label === undefined) {
      orphaned.handoffs.push(handoff);
      continue;
    }
    const match = bestMatch(canonicalId(label), tokensOf(label), units, unitCanon, unitTokens);
    if (match === undefined) {
      orphaned.handoffs.push(handoff);
    } else {
      match.value.handoffs.push(handoff);
    }
  }
}

function attachPullRequests(units: Unit[], prs: PullRequest[], orphaned: { prs: PullRequest[] }): void {
  for (const pr of prs) {
    const match = bestMatch(canonicalId(pr.headRefName), tokensOf(pr.headRefName), units, unitCanon, unitTokens);
    if (match === undefined) {
      orphaned.prs.push(pr);
      continue;
    }
    if (match.value.pr === undefined) {
      match.value.pr = {
        number: pr.number,
        state: pr.state,
        checks: pr.checks,
        url: pr.url,
      };
    }
  }
}

function prStateOf(unit: Unit): "OPEN" | "MERGED" | "CLOSED" | undefined {
  const state = unit.pr?.state.toUpperCase();
  if (state === "OPEN") return "OPEN";
  if (state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  return undefined;
}

function decideUnit(unit: Unit): void {
  const hasImpl = unit.handoffs.some((h) => isImplementationDefinition(h.definition));
  const hasReview = unit.handoffs.some((h) => h.definition?.toLowerCase() === "pr-reviewer");
  const hasQa = unit.handoffs.some((h) => h.definition?.toLowerCase() === "qa-tester");
  const evidence: Evidence = {
    hasSpec: true,
    hasWorktree: unit.worktree !== undefined,
    hasBranch: unit.branch !== undefined,
    hasImpl,
    hasReview,
    hasQa,
    liveAgentActing: unit.agents.some(isActing),
    blockedAgent: unit.agents.some((agent) => agent.state === "blocked"),
  };
  const prState = prStateOf(unit);
  if (prState !== undefined) evidence.prState = prState;
  if (unit.pr?.checks !== undefined) evidence.checks = unit.pr.checks;
  const inferred = inferUnit(evidence);
  unit.stage = inferred.stage;
  unit.flags = inferred.flags;
  unit.attention = inferred.attention;
  if (unit.parseError !== undefined && !unit.attention.includes("parse-error")) {
    unit.attention.push("parse-error");
  }
}

function collectDifferences(repoRoot: string, branches: BranchFacts[]): Map<string, DiffTotals> {
  const map = new Map<string, DiffTotals>();
  for (const branch of branches) {
    const diff = diffTotals(repoRoot, branch.name);
    if (diff !== undefined) map.set(branch.name, diff);
  }
  return map;
}

/** Assemble a full snapshot from live sources. Never throws; failures are
 *  collected into `errors` and degrade to unknown/unavailable. */
export async function buildSnapshot(opts: SnapshotOptions): Promise<FactorySnapshot> {
  const repoRoot = resolve(opts.root);
  const errors: string[] = [];
  const orphaned = { branches: [] as string[], worktrees: [] as string[], handoffs: [] as HandoffRef[], prs: [] as PullRequest[] };

  // Git facts.
  const repo = repoFacts(repoRoot);
  const branches = listFactoryBranches(repoRoot);
  const diffByBranch = collectDifferences(repoRoot, branches);
  const gitWorktreeResult = run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  const worktrees: WorktreeFacts[] = gitWorktreeResult.ok ? parseWorktrees(gitWorktreeResult.stdout) : [];
  if (!gitWorktreeResult.ok) errors.push("gitUnavailable: worktree list failed");

  // Specs → units.
  const units: Unit[] = findSpecFiles(repoRoot).map((relPath) => {
    const spec = readSpecUnit(repoRoot, relPath);
    const unit: Unit = {
      id: spec.id,
      specPath: spec.path,
      stage: "unknown",
      flags: {
        reviewPending: false,
        qaPending: false,
        ciRed: false,
        readyToMerge: false,
        readyForCleanup: false,
        needsDispatch: false,
        blockedAgent: false,
      },
      agents: [],
      handoffs: [],
      attention: [],
    };
    if (spec.title !== undefined) unit.title = spec.title;
    if (spec.goal !== undefined) unit.goal = spec.goal;
    if (spec.lane !== undefined) unit.lane = spec.lane;
    if (spec.parseError !== undefined) {
      unit.parseError = spec.parseError;
      errors.push(`spec ${spec.path}: ${spec.parseError}`);
    }
    return unit;
  }).sort((a, b) => a.id.localeCompare(b.id));

  attachBranches(units, branches, diffByBranch, orphaned);
  attachWorktrees(units, worktrees, diffByBranch, orphaned, repoRoot);

  // Herdr state (defensive).
  const herdr = readHerdr();
  errors.push(...herdr.errors);
  attachAgents(units, herdr.agents);
  attachHandoffs(units, herdr.handoffs, orphaned);

  // GitHub (via gh CLI).
  const github = await readGitHub({ noGh: opts.noGh });
  errors.push(...github.errors);
  attachPullRequests(units, github.prs, orphaned);

  for (const unit of units) decideUnit(unit);

  return {
    generatedAt: new Date().toISOString(),
    repo,
    units,
    agents: herdr.agents,
    prs: github.prs,
    orphaned: {
      branches: orphaned.branches.sort(),
      worktrees: orphaned.worktrees.sort(),
      handoffs: orphaned.handoffs,
      prs: orphaned.prs,
    },
    errors,
  };
}
