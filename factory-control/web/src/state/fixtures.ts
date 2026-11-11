import type { AgentRecord, FactorySnapshot, Unit } from "@maze/factory-control-shared";

/**
 * A deterministic fixture snapshot covering every stage column, attention
 * kind, lifecycle state, and orphaned bucket. Used by the pure-selector unit
 * tests and by the SSR rendering integration test.
 */

export function fixtureSnapshot(): FactorySnapshot {
  const t10: Unit = {
    id: "T10-execute",
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
    units: [t10, t11, t12, t13, t14, t15],
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
