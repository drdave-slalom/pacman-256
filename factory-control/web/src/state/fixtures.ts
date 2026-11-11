import type { AgentRecord, FactorySnapshot, IssueCard, IssueLabels, Unit } from "@maze/factory-control-shared";

/**
 * A deterministic fixture snapshot covering every stage column, attention
 * kind, lifecycle state, and orphaned bucket. Used by the pure-selector unit
 * tests and by the SSR rendering integration test.
 */

export function fixtureSnapshot(): FactorySnapshot {
  const t10: Unit = {
    id: "T10-execute",
    kind: "spec",
    specPath: "SPEC/T10-execute.md",
    title: "T10: execute fixture",
    goal: "Prove the execute stage renders with agents and a diff.",
    lane: "Gameplay",
    stage: "execute",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: false,
      blockedAgent: false,
    },
    branch: "factory/t10-execute",
    worktree: {
      path: "/tmp/wt-fc-t10",
      dirty: true,
      diff: { add: 42, del: 7, files: 5 },
    },
    agents: [workingAgent("builder-fc-t10-execute", "builder")],
    handoffs: [
      {
        agent: "builder-fc-t10-execute",
        definition: "builder",
        sessionId: "result:builder#3",
        excerpt: "Implemented the board selectors.",
        source: "result",
      },
    ],
    pr: { number: 42, state: "OPEN", checks: "green", url: "https://github.com/x/pacman-256/pull/42" },
    attention: ["review-pending"],
  };

  const t11: Unit = {
    id: "T11-review",
    kind: "spec",
    specPath: "SPEC/T11-review.md",
    title: "T11: review fixture",
    goal: "Prove the review stage renders a pending review.",
    lane: "Multiplayer",
    stage: "review",
    flags: {
      reviewPending: true,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: false,
      blockedAgent: false,
    },
    branch: "factory/t11-review",
    agents: [idleAgent("pr-reviewer-fc-t11-review", "pr-reviewer")],
    handoffs: [
      {
        agent: "builder-fc-t11-review",
        definition: "builder",
        sessionId: "result:builder#4",
        excerpt: "Implemented the detail view.",
        source: "result",
      },
      {
        agent: "pr-reviewer-fc-t11-review",
        definition: "pr-reviewer",
        sessionId: "result:pr-reviewer#1",
        excerpt: "Review pass in progress.",
        source: "result",
      },
    ],
    pr: { number: 43, state: "OPEN", checks: "pending", url: "https://github.com/x/pacman-256/pull/43" },
    attention: ["review-pending"],
  };

  const t12: Unit = {
    id: "T12-integrate",
    kind: "spec",
    specPath: "SPEC/T12-integrate.md",
    title: "T12: integrate fixture",
    goal: "Prove an open PR with green checks is ready to merge.",
    stage: "integrate",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: true,
      readyForCleanup: false,
      needsDispatch: false,
      blockedAgent: false,
    },
    agents: [],
    handoffs: [],
    pr: { number: 44, state: "OPEN", checks: "green", url: "https://github.com/x/pacman-256/pull/44" },
    attention: ["ready-to-merge"],
  };

  const t13: Unit = {
    id: "T13-unknown",
    kind: "spec",
    specPath: "SPEC/T13-unknown.md",
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

  const t14: Unit = {
    id: "T14-done",
    kind: "spec",
    specPath: "SPEC/T14-done.md",
    title: "T14: done fixture",
    goal: "Prove a merged unit with a lingering worktree flags cleanup.",
    stage: "done",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: true,
      needsDispatch: false,
      blockedAgent: false,
    },
    branch: "factory/t14-done",
    worktree: {
      path: "/tmp/wt-fc-t14",
      dirty: false,
      diff: { add: 10, del: 2, files: 3 },
    },
    agents: [],
    handoffs: [{ agent: "builder-fc-t14-done", definition: "builder", sessionId: "result:builder#5", source: "result" }],
    pr: { number: 45, state: "MERGED", checks: "green", url: "https://github.com/x/pacman-256/pull/45" },
    attention: ["ready-for-cleanup"],
  };

  const t15: Unit = {
    id: "T15-parse",
    kind: "spec",
    specPath: "SPEC/T15-parse.md",
    parseError: "expected ## Goal",
    stage: "spec",
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
    attention: ["parse-error"],
  };

  const i16: Unit = {
    id: "I16-issue",
    kind: "issue",
    title: "Fix lane inference for hybrid units",
    stage: "spec",
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
    issue: issueCard({
      number: 16,
      title: "Fix lane inference for hybrid units",
      state: "open",
      url: "https://github.com/x/pacman-256/issues/16",
      bodyExcerpt: "When a unit links both a spec and an issue, lane inference should prefer the issue's lane.",
      labels: labelSet({
        type: "bug",
        role: ["builder"],
        lane: "B",
        status: "spec",
        blocked: true,
        followUp: false,
        playtest: false,
        raw: ["type:bug", "role:builder", "lane:B", "status:spec", "blocked", "priority:high"],
      }),
      assignees: ["@chase"],
      milestone: "M2",
      createdAt: "2026-01-05T10:00:00Z",
      updatedAt: "2026-01-12T14:30:00Z",
    }),
  };

  const t17: Unit = {
    id: "T17-hybrid",
    kind: "hybrid",
    specPath: "SPEC/T17-hybrid.md",
    title: "T17: hybrid issue + spec",
    stage: "review",
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
    issue: issueCard({
      number: 17,
      title: "T17: hybrid issue + spec",
      state: "closed",
      url: "https://github.com/x/pacman-256/issues/17",
      bodyExcerpt: "Closes #17; carries the spec and links the issue.",
      labels: labelSet({
        type: "feature",
        role: ["qa", "review"],
        lane: "A",
        status: "review",
        blocked: false,
        followUp: true,
        playtest: true,
        raw: ["type:feature", "role:qa", "role:review", "lane:A", "status:review", "follow-up", "playtest"],
      }),
      assignees: ["@lead"],
      createdAt: "2026-02-01T09:00:00Z",
      updatedAt: "2026-02-03T11:20:00Z",
    }),
  };

  const agents: AgentRecord[] = [
    workingAgent("builder-fc-t10-execute", "builder"),
    blockedAgent("builder-fc-t07-blocked", "builder"),
    idleAgent("pr-reviewer-fc-t11-review", "pr-reviewer"),
    { label: "docs-writer-fc-t02-done", definition: "docs-writer", state: "done", availableTools: ["write"], source: "result", elapsedMs: 900_000 },
    { label: "scout-fc-mystery", definition: "scout", state: "lost", availableTools: [], source: "unknown" },
    { label: "qa-tester-fc-t09-starting", definition: "qa-tester", state: "starting", availableTools: ["read"], source: "mailbox", elapsedMs: 12_000, model: "mercury-1", thinking: true, contextPct: 8 },
  ];

  return {
    generatedAt: new Date().toISOString(),
    repo: { root: "/repo/pacman-256", branch: "main", dirty: false },
    units: [t10, t11, t12, t13, t14, t15, i16, t17],
    issues: [i16.issue!, t17.issue!],
    agents,
    prs: [
      { number: 42, title: "T10: execute fixture", state: "OPEN", headRefName: "factory/t10-execute", url: "https://github.com/x/pacman-256/pull/42", checks: "green" },
      { number: 99, title: "orphan", state: "OPEN", headRefName: "factory/orphan-branch", url: "https://github.com/x/pacman-256/pull/99", checks: "red" },
    ],
    orphaned: {
      branches: ["origin/factory/orphan-branch"],
      worktrees: ["/tmp/wt-orphan"],
      handoffs: [{ agent: "scout-fc-mystery", definition: "scout", sessionId: "result:scout#2", excerpt: "unmatched trail", source: "result" }],
      prs: [{ number: 99, title: "orphan", state: "OPEN", headRefName: "factory/orphan-branch", url: "https://github.com/x/pacman-256/pull/99", checks: "red" }],
    },
    errors: [],
  };
}

/**
 * Snapshot variant with closed issues: the hybrid issue (#17) is already
 * closed and linked (must be excluded from closed-unmatched), and two closed
 * issues (#53, #60) are unattached. Used by the show-closed toggle tests.
 */
export function fixtureSnapshotWithClosedIssues(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  const base = fixtureSnapshot();
  const closedUnmatched: IssueCard[] = [
    {
      number: 53,
      title: "Closed issue without a unit",
      state: "closed",
      url: "https://github.com/x/pacman-256/issues/53",
      bodyExcerpt: "Resolved in #42.",
      labels: {
        type: "bug",
        role: [],
        status: "done",
        blocked: false,
        followUp: false,
        playtest: false,
        raw: ["type:bug", "status:done"],
      },
      assignees: [],
      milestone: "M1",
      createdAt: "2026-01-01T09:00:00Z",
      updatedAt: "2026-01-20T10:00:00Z",
    },
    {
      number: 60,
      title: "Another closed orphan issue",
      state: "closed",
      url: "https://github.com/x/pacman-256/issues/60",
      labels: {
        type: "feature",
        role: [],
        blocked: false,
        followUp: true,
        playtest: false,
        raw: ["type:feature", "follow-up"],
      },
      assignees: [],
    },
  ];
  return {
    ...base,
    issues: [...base.issues, ...closedUnmatched],
    ...overrides,
  };
}

function workingAgent(label: string, definition: string): AgentRecord {
  return {
    label,
    definition,
    state: "working",
    elapsedMs: 243_000,
    model: "mercury-1",
    thinking: true,
    contextPct: 31,
    stale: false,
    availableTools: ["read", "edit"],
    source: "result",
  };
}

function blockedAgent(label: string, definition: string): AgentRecord {
  return {
    label,
    definition,
    state: "blocked",
    elapsedMs: 1_800_000,
    stale: false,
    availableTools: ["read"],
    source: "result",
  };
}

function idleAgent(label: string, definition: string): AgentRecord {
  return {
    label,
    definition,
    state: "idle",
    elapsedMs: 2_400_000,
    stale: true,
    availableTools: ["read", "grep"],
    source: "result",
  };
}

function labelSet(p: {
  type?: string;
  role?: string[];
  lane?: string;
  status?: string;
  blocked?: boolean;
  followUp?: boolean;
  playtest?: boolean;
  raw: string[];
}): IssueLabels {
  const labels: IssueLabels = {
    role: p.role ?? [],
    blocked: p.blocked ?? false,
    followUp: p.followUp ?? false,
    playtest: p.playtest ?? false,
    raw: p.raw,
  };
  if (p.type !== undefined) labels.type = p.type;
  if (p.lane !== undefined) labels.lane = p.lane;
  if (p.status !== undefined) labels.status = p.status;
  return labels;
}

function issueCard(p: {
  number: number;
  title: string;
  state: "open" | "closed" | "unknown";
  url: string;
  labels: IssueLabels;
  assignees: string[];
  bodyExcerpt?: string;
  milestone?: string;
  createdAt?: string;
  updatedAt?: string;
}): IssueCard {
  const card: IssueCard = {
    number: p.number,
    title: p.title,
    state: p.state,
    url: p.url,
    labels: p.labels,
    assignees: p.assignees,
  };
  if (p.bodyExcerpt !== undefined) card.bodyExcerpt = p.bodyExcerpt;
  if (p.milestone !== undefined) card.milestone = p.milestone;
  if (p.createdAt !== undefined) card.createdAt = p.createdAt;
  if (p.updatedAt !== undefined) card.updatedAt = p.updatedAt;
  return card;
}
