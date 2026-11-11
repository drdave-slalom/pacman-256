# Draft Item

**Title:** M2: Let the operator run gate-checked factory actions safely
**Type:** Ticket
**Parent:** Factory control center (M0–M4)
**Length:** 320 words

## Summary

A guarded action API, used only by the pi TUI, for the factory steps: create and
remove worktrees, run checks, open PRs, watch CI, and merge. Every action
enforces factory gate preconditions computed from the snapshot, requires an
explicit prepare→confirm→execute flow, and writes an audit log. The web mirror
stays read-only.

## User Story

As the factory Lead, I want to trigger standard factory steps without leaving the
terminal or breaking gates, so that approvals stay explicit and traceable.

## Acceptance Criteria

1. Each action runs only when its snapshot-derived preconditions pass; violations
   reject with 409 and the reasons.
2. No mutation executes without a matched confirmed prepare and3. Merges require green checks, review and QA handoffs, and explicit confirm.
4. Worktree removal requires merged plus green CI (or explicit override +
   confirm).
5. Per-unit locks prevent overlapping writers and mutations.
6. The audit log records every prepare/execute, append-only, with operator and
   outcome.
7. The web mirror has no route to these endpoints.
8. `npm run check` passes with the new workspace wired.

## Technical Notes

- **Location:** `factory-control/server/` action modules; endpoints
  `POST /api/actions/<name>/prepare` (returns requestId + preconditions + plan)
  and `POST /api/actions/<name>/execute` (`{requestId, confirm: true, approvedBy}`).
  Header `X-Control-Token` (server-configured; required for remote operator
  sessions, optional on localhost).
- **Actions & guards:**
  - `worktree/create` → `scripts/factory-worktree.sh create <unit>`; guard:
    SPEC exists, no `factory/<unit>` branch/worktree, no live writer.
  - `worktree/remove` → guard: merged + green CI (or override + confirm), no
    live agent on the unit.
  - `checks/run` → `npm run check` in the unit worktree; guard: worktree exists.
  - `pr/open` → `gh pr create`; guard: review and QA handoffs present.
  - `ci/watch` → `gh pr checks <pr> --watch` (TUI pane); server provides
    `checks/query`.
  - `pr/merge` → `gh pr merge`; guard: PR open, checks green, review + QA
    handoffs, explicit confirm.
  - `main/merge` (direct) → guard: explicit user approval, CI green, review +
    QA, override.
- **Audit:** `factory-control/state/audit.log.jsonl` (gitignored):
  `{at, action, requestId, operator, ip, unit?, pr?, preconditions, outcome, exit?}`.
- **Locks:** `factory-control/state/locks/<unit>.lock`; stale locks (>1 h, no
  live agent) releasable with override.

## Testing

- Unit: precondition functions over fixture snapshots (pass/fail + reasons).
- Integration: temp git repo with fixture unit — prepare→execute succeeds;
  execute without prepare rejected; gate violations return 409 and run no
  command; audit lines appended with operator/reasons; lock blocks concurrent
  mutation.
- Safety: denied `pr/merge` never touches `gh`; `worktree/remove` without
  merged+green is rejected.

## Item Links

- blocked by: M0-snapshot-core
- blocks: M3-tui-extension
