# Draft Item

**Title:** M4: Start new agent work from the control center into Herdr panes
**Type:** Ticket
**Parent:** Factory control center (M0–M4)
**Length:** 300 words

## Summary

Operator-driven triggers: turn a Spec-stage unit into a delegation request the
Lead confirms, and offer skill triggers (e.g. `open-pr`, role skills). The
control server only enqueues requests; the Lead performs the actual delegation,
so each subagent starts as a new tab/pane in Herdr. The server never spawns
agents.

## User Story

As the factory Lead, I want to queue a dispatch from the board and execute it in
my session, so that new agent work starts as normal Herdr panes with the
one-executor rule intact.

## Acceptance Criteria

1. Prepare only accepts units with a SPEC file and no active writer/worktree.
2. The server never spawns agents; it only persists and lists queue entries.
3. Entries transition queued → dispatched → done/cancelled and persist
   append-only.
4. Snapshot evidence (live agent match; handoff present) closes entries to done.
5. The TUI lists queue entries and generates a ready-to-paste delegation prompt.
6. A dispatched unit shows a live agent row and later a handoff in the snapshot.
7. The resulting agent appears as a new tab/pane in Herdr (manual smoke).
8. `npm run check` passes.

## Technical Notes

- **Queue:** `factory-control/state/dispatch-queue/queue.jsonl` (gitignored),
  entries `{id, at, unit, specPath, worktree, role, acceptance, status}`; skill
  entries add `skill` and `contextRefs`. Status transitions only:
  `queued → dispatched → done/cancelled`. Server marks dispatched/done from
  snapshot evidence only; the Lead may also update status.
- **Endpoints:** `POST /api/dispatch/prepare`, `POST /api/dispatch/enqueue`,
  `GET /api/dispatch/queue`, `POST /api/dispatch/status {id, status}`.
- **Delegation prompt template** (printed by TUI for the Lead): spec path,
  worktree (`factory/<unit>`), suggested role, acceptance summary, expected
  handoff — ready to use with the Lead's standard delegation tools.
- **Skill triggers:** e.g. `open-pr` for Integrate-stage units; role skills
  (`qa-tester`, `pr-reviewer`) for validation. The Lead executes the skill by
  delegating to the matching role agent; the agent opens as a new Herdr pane.
- **Honesty:** entries never auto-execute; no server-side agent launch.

## Testing

- Unit: queue state transitions; prepare validation (reject active writer);
  snapshot-evidence transition logic.
- Integration (temp dir): enqueue; assert no agent/process spawned; entry is
  JSONL-persisted and listable; simulated dispatched → fixture handoff closes to
  done.
- Manual: in the pi session run the dispatch flow for a stub unit; confirm the
  agent opens as a new Herdr pane; run the `open-pr` trigger on a fixture
  PR-ready unit and confirm agent pane + resulting PR.

## Item Links

- blocked by: M0-snapshot-core
