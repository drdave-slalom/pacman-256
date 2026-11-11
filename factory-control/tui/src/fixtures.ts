/**
 * Fixture snapshots for the factory-control TUI unit tests.
 */

import type { FactorySnapshot, IssueCard, Unit } from "@maze/factory-control-shared";

/** A full issue card (open, `status:ready`). */
export function issueCardFixture(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    number: 12,
    title: "Mobile touch controls feel laggy",
    state: "open",
    url: "https://github.com/example/repo/issues/12",
    bodyExcerpt: "Touch joystick input has ~100ms latency on Android Chrome; feels unresponsive.",
    labels: {
      type: "bug",
      role: ["builder", "qa"],
      lane: "B",
      status: "ready",
      blocked: false,
      followUp: false,
      playtest: true,
      raw: ["type:bug", "role:builder", "role:qa", "lane:B", "status:ready", "playtest"],
    },
    assignees: ["alice"],
    milestone: "MVP",
    createdAt: "2026-01-10T10:00:00.000Z",
    updatedAt: "2026-01-11T12:30:00.000Z",
    ...overrides,
  };
}

/** A standalone issue card unit (no linked spec). */
export function standaloneIssueUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "issue12",
    kind: "issue",
    title: "Mobile touch controls feel laggy",
    issue: issueCardFixture(),
    stage: "spec",
    flags: {
      reviewPending: false,
      qaPending: false,
      ciRed: false,
      readyToMerge: false,
      readyForCleanup: false,
      needsDispatch: true,
      blockedAgent: false,
    },
    agents: [],
    handoffs: [],
    attention: ["needs-dispatch"],
    ...overrides,
  };
}

/** A hybrid unit (spec unit linked to an issue via `Closes #N`). */
export function hybridIssueUnit(overrides: Partial<Unit> = {}): Unit {
  const base = fixtureSnapshot().units.find((u) => u.id === "T3-review");
  if (base === undefined) throw new Error("fixture missing T3-review");
  return {
    ...base,
    kind: "hybrid",
    issue: {
      number: 7,
      title: "Add sound effects",
      state: "open",
      url: "https://github.com/example/repo/issues/7",
      bodyExcerpt: "Maze ambience + pickup sounds.",
      labels: {
        type: "feature",
        role: ["art"],
        lane: "C",
        status: "review",
        blocked: false,
        followUp: false,
        playtest: false,
        raw: ["type:feature", "role:art", "lane:C", "status:review"],
      },
      assignees: [],
      milestone: "MVP",
      createdAt: "2026-01-05T09:00:00.000Z",
      updatedAt: "2026-01-09T16:00:00.000Z",
    },
    ...overrides,
  };
}

/**
 * Snapshot variant with issue cards: T3-review is replaced by a hybrid unit and
 * a standalone issue unit is appended. Existing tests keep using `fixtureSnapshot`.
 */
export function fixtureSnapshotWithIssues(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  const base = fixtureSnapshot();
  const hybrid = hybridIssueUnit();
  const standalone = standaloneIssueUnit();
  const units = base.units.map((u) => (u.id === "T3-review" ? hybrid : u));
  return {
    ...base,
    units: [...units, standalone],
    issues: [standalone.issue!, hybrid.issue!],
    ...overrides,
  };
}

/**
 * Snapshot variant with closed issues: the hybrid issue (#7) is closed and
 * linked (must be excluded from closed-unmatched), and two closed issues
 * (#53, #60) are unattached. Used by the show-closed toggle tests.
 */
export function fixtureSnapshotWithClosedIssues(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  const base = fixtureSnapshotWithIssues();
  const units = base.units.map((u) =>
    u.id === "T3-review" && u.issue !== undefined
      ? { ...u, issue: { ...u.issue, state: "closed" as const } }
      : u,
  );
  const closedUnmatched: IssueCard[] = [
    {
      number: 53,
      title: "Closed issue without a unit",
      state: "closed",
      url: "https://github.com/example/repo/issues/53",
      bodyExcerpt: "Resolved in #41.",
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
      milestone: "MVP",
      createdAt: "2026-01-01T09:00:00.000Z",
      updatedAt: "2026-01-20T10:00:00.000Z",
    },
    {
      number: 60,
      title: "Another closed orphan issue",
      state: "closed",
      url: "https://github.com/example/repo/issues/60",
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
  const issues = base.issues
    .map((iss) => (iss.number === 7 ? { ...iss, state: "closed" as const } : iss))
    .concat(closedUnmatched);
  return {
    ...base,
    units,
    issues,
    ...overrides,
  };
}

export function fixtureSnapshot(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  return {
    generatedAt: new Date(Date.now() - 90_000).toISOString(),
    repo: { root: "/repo/primary", branch: "main", dirty: false },
    units: [
      {
        id: "T1-spec",
        kind: "spec",
        specPath: "SPEC/T1-spec.md",
        title: "T1 spec",
        goal: "Goal for T1",
        lane: "Platform",
        stage: "spec",
        flags: {
          reviewPending: false,
          qaPending: false,
          ciRed: false,
          readyToMerge: false,
          readyForCleanup: false,
          needsDispatch: true,
          blockedAgent: false,
        },
        agents: [],
        handoffs: [],
        attention: ["needs-dispatch"],
      },
      {
        id: "T2-execute",
        kind: "spec",
        specPath: "SPEC/T2-execute.md",
        title: "T2 execute",
        stage: "execute",
        flags: {
          reviewPending: false,
          qaPending: false,
          ciRed: false,
          readyToMerge: false,
          readyForCleanup: false,
          needsDispatch: false,
          blockedAgent: true,
        },
        branch: "factory/t2-execute",
        worktree: { path: "/wt/t2", dirty: true, diff: { add: 10, del: 2, files: 3 } },
        agents: [
          {
            label: "builder-t2",
            definition: "builder",
            state: "working",
            elapsedMs: 420_000,
            model: "mercury-1",
            thinking: true,
            contextPct: 40,
            stale: false,
            availableTools: ["read"],
            source: "result",
          },
        ],
        handoffs: [
          {
            agent: "builder-t2",
            definition: "builder",
            sessionId: "result:builder#2",
            excerpt: "Done.",
            source: "result",
          },
        ],
        attention: ["blocked-agent"],
      },
      {
        id: "T3-review",
        kind: "spec",
        specPath: "SPEC/T3-review.md",
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
        branch: "factory/t3-review",
        worktree: { path: "/wt/t3", dirty: false },
        agents: [],
        handoffs: [{ definition: "pr-reviewer", source: "result" }],
        pr: { number: 3, state: "OPEN", checks: "green", url: "https://example/pull/3" },
        attention: ["review-pending"],
      },
      {
        id: "T4-merged",
        kind: "spec",
        specPath: "SPEC/T4-merged.md",
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
        branch: "factory/t4-merged",
        worktree: { path: "/wt/t4", dirty: false },
        agents: [],
        handoffs: [
          {
            agent: "qa-tester-x",
            definition: "qa-tester",
            sessionId: "result:qa#4",
            source: "result",
          },
        ],
        pr: { number: 4, state: "MERGED", checks: "green", url: "https://example/pull/4" },
        attention: ["ready-for-cleanup"],
      },
    ],
    issues: [],
    agents: [
      {
        label: "builder-t2",
        definition: "builder",
        state: "working",
        elapsedMs: 420_000,
        model: "mercury-1",
        thinking: true,
        contextPct: 40,
        stale: false,
        availableTools: ["read"],
        source: "result",
      },
      {
        label: "idle-x",
        definition: "pr-reviewer",
        state: "idle",
        elapsedMs: 900_000,
        stale: true,
        availableTools: [],
        source: "unknown",
      },
    ],
    prs: [
      {
        number: 3,
        title: "PR3",
        state: "OPEN",
        headRefName: "factory/t3-review",
        url: "https://example/pull/3",
        checks: "green",
      },
    ],
    orphaned: {
      branches: ["origin/factory/orphan1"],
      worktrees: ["/tmp/wt-orphan"],
      prs: [],
      handoffs: [],
    },
    errors: [],
    ...overrides,
  };
}
