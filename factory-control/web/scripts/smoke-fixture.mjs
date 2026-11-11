/** Minimal fixture snapshot for the end-to-end smoke (plain JS). */
export function fixtureSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    repo: { root: "/repo/pacman-256", branch: "main", dirty: false },
    units: [
      {
        id: "T9-smoke",
        specPath: "SPEC/T9-smoke.md",
        title: "T9: smoke fixture",
        goal: "Bootstrap the read-only web mirror.",
        lane: "Platform",
        stage: "execute",
        flags: { reviewPending: false, qaPending: false, ciRed: false, readyToMerge: false, readyForCleanup: false, needsDispatch: false, blockedAgent: false },
        branch: "factory/t9-smoke",
        worktree: { path: "/tmp/wt-fc-t9", dirty: true, diff: { add: 12, del: 3, files: 4 } },
        agents: [{ label: "builder-fc-t9-smoke", definition: "builder", state: "working", elapsedMs: 90000, model: "mercury-1", thinking: true, contextPct: 22, stale: false, availableTools: ["read"], source: "result" }],
        handoffs: [{ agent: "builder-fc-t9-smoke", definition: "builder", sessionId: "result:builder#9", excerpt: "Built the smoke fixture.", source: "result" }],
        pr: { number: 9, state: "OPEN", checks: "green", url: "https://github.com/x/pacman-256/pull/9" },
        attention: ["review-pending"],
      },
      {
        id: "T8-done",
        specPath: "SPEC/T8-done.md",
        stage: "done",
        flags: { reviewPending: false, qaPending: false, ciRed: false, readyToMerge: false, readyForCleanup: true, needsDispatch: false, blockedAgent: false },
        agents: [],
        handoffs: [],
        branch: "factory/t8-done",
        attention: ["ready-for-cleanup"],
      },
    ],
    agents: [
      { label: "builder-fc-t9-smoke", definition: "builder", state: "working", elapsedMs: 90000, model: "mercury-1", thinking: true, contextPct: 22, stale: false, availableTools: ["read"], source: "result" },
      { label: "pr-reviewer-fc-t8-idle", definition: "pr-reviewer", state: "idle", elapsedMs: 600000, stale: true, availableTools: ["read"], source: "result" },
    ],
    prs: [
      { number: 9, title: "T9: smoke fixture", state: "OPEN", headRefName: "factory/t9-smoke", url: "https://github.com/x/pacman-256/pull/9", checks: "green" },
    ],
    orphaned: { branches: ["origin/factory/orphan-branch"], worktrees: [], handoffs: [], prs: [] },
    errors: [],
  };
}
