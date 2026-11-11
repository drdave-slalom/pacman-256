import { resolve } from "node:path";
import { bestMatch, canonicalId, tokensOf } from "./canonical.ts";
import { diffTotals, isDirty, listFactoryBranches, parseWorktrees, repoFacts, run } from "./git.ts";
import { readGitHub, readGitHubIssues } from "./github.ts";
import { readHerdr } from "./herdr.ts";
import { inferIssueUnit, inferUnit, isImplementationDefinition, type Evidence, type IssueEvidence } from "./infer.ts";
import { findSpecFiles, readSpecUnit } from "./markdown.ts";
import type {
  AgentRecord,
  BranchFacts,
  DiffTotals,
  FactorySnapshot,
  HandoffRef,
  IssueCard,
  PullRequest,
  Unit,
  WorktreeFacts,
} from "./types.ts";

export interface SnapshotOptions {
  root: string;
  noGh: boolean;
  /** Runner override (tests inject a fake gh); defaults to the real runner. */
  runner?: typeof run;
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

async function attachWorktrees(
  units: Unit[],
  worktrees: WorktreeFacts[],
  diffByBranch: Map<string, DiffTotals>,
  orphaned: { worktrees: string[] },
  repoRoot: string,
): Promise<void> {
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
      dirty: await isDirty(worktree.path),
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

function makeIssueUnit(issue: IssueCard): Unit {
  return {
    id: canonicalId("issue" + String(issue.number)),
    kind: "issue",
    title: issue.title,
    issue,
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
}

function decideIssueUnit(unit: Unit): void {
  if (unit.issue === undefined) return;
  const evidence: IssueEvidence = {
    hasBranch: unit.branch !== undefined,
    hasWorktree: unit.worktree !== undefined,
    liveAgentActing: unit.agents.some(isActing),
    blockedAgent: unit.agents.some((agent) => agent.state === "blocked"),
  };
  const prState = prStateOf(unit);
  if (prState !== undefined) evidence.prState = prState;
  if (unit.pr?.checks !== undefined) evidence.checks = unit.pr.checks;
  const inferred = inferIssueUnit(unit.issue, evidence);
  unit.stage = inferred.stage;
  unit.flags = inferred.flags;
  unit.attention = inferred.attention;
}

async function collectDifferences(repoRoot: string, branches: BranchFacts[]): Promise<Map<string, DiffTotals>> {
  const map = new Map<string, DiffTotals>();
  for (const branch of branches) {
    const diff = await diffTotals(repoRoot, branch.name);
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
  const repo = await repoFacts(repoRoot);
  const branches = await listFactoryBranches(repoRoot);
  const diffByBranch = await collectDifferences(repoRoot, branches);
  const gitWorktreeResult = await run("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
  const worktrees: WorktreeFacts[] = gitWorktreeResult.ok ? parseWorktrees(gitWorktreeResult.stdout) : [];
  if (!gitWorktreeResult.ok) errors.push("gitUnavailable: worktree list failed");

  // GitHub (via gh CLI): PRs + issues are read once, early, so issue cards
  // can participate in branch/PR matching like spec units.
  const github = await readGitHub({ noGh: opts.noGh }, opts.runner);
  const githubIssues = await readGitHubIssues({ noGh: opts.noGh }, opts.runner);
  errors.push(...github.errors, ...githubIssues.errors);

  // Specs → units (spec source refs are collected for issue linking).
  const specUnits = findSpecFiles(repoRoot).map((relPath) => {
    const spec = readSpecUnit(repoRoot, relPath);
    const unit: Unit = {
      id: spec.id,
      kind: "spec",
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
    return { unit, refs: spec.issueRefs ?? [] };
  });
  const units: Unit[] = specUnits.map((s) => s.unit);

  // Issue ↔ unit linking: spec-file references first, then PR-body references
  // (PRs join units via the existing bestMatch machinery). First-wins keeps
  // the mapping deterministic.
  const linkByIssue = new Map<number, Unit>();
  for (const { unit, refs } of specUnits) {
    for (const ref of refs) {
      if (!linkByIssue.has(ref)) linkByIssue.set(ref, unit);
    }
  }
  for (const pr of github.prs) {
    const refs = github.prIssueRefs[pr.number];
    if (refs === undefined || refs.length === 0) continue;
    const match = bestMatch(canonicalId(pr.headRefName), tokensOf(pr.headRefName), units, unitCanon, unitTokens);
    if (match === undefined) continue;
    for (const ref of refs) {
      if (!linkByIssue.has(ref)) linkByIssue.set(ref, match.value);
    }
  }

  // Attach referenced issues to their linked unit (hybrid — closes issues are
  // attached too, for history); unmatched OPEN issues become standalone cards.
  for (const issue of githubIssues.issues) {
    const linked = linkByIssue.get(issue.number);
    if (linked !== undefined) {
      linked.kind = "hybrid";
      linked.issue = issue;
    } else if (issue.state === "open") {
      units.push(makeIssueUnit(issue));
    }
  }
  units.sort((a, b) => a.id.localeCompare(b.id));

  attachBranches(units, branches, diffByBranch, orphaned);
  await attachWorktrees(units, worktrees, diffByBranch, orphaned, repoRoot);

  // Herdr state (defensive).
  const herdr = readHerdr();
  errors.push(...herdr.errors);
  attachAgents(units, herdr.agents);
  attachHandoffs(units, herdr.handoffs, orphaned);

  attachPullRequests(units, github.prs, orphaned);

  for (const unit of units) {
    if (unit.kind === "issue") decideIssueUnit(unit);
    else decideUnit(unit);
  }

  return {
    generatedAt: new Date().toISOString(),
    repo,
    units,
    issues: githubIssues.issues,
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
