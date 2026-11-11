/**
 * Snapshot model for the factory control center (M0), shared verbatim
 * between the factory-control server (M0+) and the read-only web mirror
 * (M1). All enumerations are closed unions so the compiler catches drift
 * between the spec vocabulary and the code.
 *
 * Mirrors `factory-control/SPEC/factory-control-snapshot.md`.
 */

export type Lifecycle =
  | "working"
  | "blocked"
  | "settling"
  | "starting"
  | "idle"
  | "done"
  | "unknown"
  | "lost";

export type Stage =
  | "spec"
  | "dispatch"
  | "execute"
  | "review"
  | "qa"
  | "integrate"
  | "ci"
  | "done"
  | "unknown";

export type CheckState =
  | "green"
  | "red"
  | "pending"
  | "none"
  | "unavailable"
  | "unknown";

export type Attention =
  | "blocked-agent"
  | "review-pending"
  | "qa-pending"
  | "ci-red"
  | "ready-to-merge"
  | "ready-for-cleanup"
  | "needs-dispatch"
  | "orphaned-artifacts"
  | "parse-error";

export interface AgentRecord {
  label: string;
  definition: string;
  state: Lifecycle;
  elapsedMs?: number;
  model?: string;
  thinking?: boolean;
  contextPct?: number;
  stale?: boolean;
  inactiveMs?: number;
  lastActivityAt?: string;
  availableTools: string[];
  source: "mailbox" | "result" | "unknown";
}

export interface HandoffRef {
  agent?: string;
  definition?: string;
  sessionId?: string;
  excerpt?: string;
  source: "result" | "unknown";
  parseError?: string;
}

export interface DiffTotals {
  add: number;
  del: number;
  files: number;
}

export interface UnitWorktree {
  path: string;
  dirty: boolean;
  diff?: DiffTotals;
}

export interface UnitFlags {
  reviewPending: boolean;
  qaPending: boolean;
  ciRed: boolean;
  readyToMerge: boolean;
  readyForCleanup: boolean;
  needsDispatch: boolean;
  blockedAgent: boolean;
}

export interface UnitPr {
  number: number;
  state: string;
  checks: CheckState;
  url: string;
}

export type UnitKind = "spec" | "issue" | "hybrid" | "unknown";

export interface IssueLabels {
  type?: string;        // type:feature|bug|chore|docs
  role?: string[];      // role:builder|qa|review|design|art|docs (0..n)
  lane?: string;        // lane:A|B|C
  status?: string;      // status:spec|ready|in-progress|review
  blocked: boolean;     // label "blocked"
  followUp: boolean;    // label "follow-up"
  playtest: boolean;    // label "playtest"
  raw: string[];        // every label name, verbatim
}

export interface IssueCard {
  number: number;
  title: string;
  state: "open" | "closed" | "unknown";
  url: string;
  bodyExcerpt?: string; // trimmed first ~200 chars of body (defensive)
  labels: IssueLabels;
  assignees: string[];
  milestone?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Unit {
  id: string;
  kind: UnitKind;
  specPath?: string;
  title?: string;
  goal?: string;
  lane?: string;
  parseError?: string;
  stage: Stage;
  flags: UnitFlags;
  branch?: string;
  worktree?: UnitWorktree;
  agents: AgentRecord[];
  handoffs: HandoffRef[];
  pr?: UnitPr;
  issue?: IssueCard; // set when unit is seeded from or linked to an issue
  attention: Attention[];
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  url: string;
  checks: CheckState;
}

export interface RepoFacts {
  root: string;
  branch: string;
  dirty: boolean;
}

export interface BranchFacts {
  /** Display name, e.g. `factory/t6` or `origin/factory/t6`. */
  name: string;
  /** Canonical id used for unit matching. */
  canonical: string;
  remote: boolean;
  diff?: DiffTotals;
}

export interface WorktreeFacts {
  path: string;
  branch?: string;
}

export interface OrphanedBucket {
  branches: string[];
  worktrees: string[];
  handoffs: HandoffRef[];
  prs: PullRequest[];
}

export interface FactorySnapshot {
  generatedAt: string;
  repo: RepoFacts;
  units: Unit[];
  issues: IssueCard[]; // all ingested issues (open + closed), raw
  agents: AgentRecord[];
  prs: PullRequest[];
  orphaned: OrphanedBucket;
  errors: string[];
}
