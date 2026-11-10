# M2 spec: factory-control guarded actions API

**Status:** Draft — not approved; do not implement until the Lead approves and a
ticket is assigned. · **Workstream:** pacman-256 factory control center (M2)
**Sources:** [brainstorm](factory-control-brainstorm.md),
[M0 snapshot spec](factory-control-snapshot.md), [factory guide](../../docs/FACTORY.md)
(standing gates D048/D050).

## Goal

A guarded **action API** in the factory-control server for the operator-side TUI
(M3). It is the only place that mutates git/GitHub/scripts, and it enforces the
factory gates as preconditions. Every action is logged to an audit trail. The web
mirror remains read-only and never calls these endpoints (decision 5).

Actions: create/remove worktree, run checks, open PR, watch CI, approve/merge.

## Out of scope

- Web-facing actions (web stays read-only).
- Spawning agents / delegation (M4) — never performed here.
- Automating human approval (explicit confirm is required).

## Principles

1. **Gate preconditions are computed from the snapshot**, not trusted from the
   caller. Each action declares a precondition function that returns
   pass/fail + reasons.
2. **Two-step confirm** for every mutation: the TUI first calls a
   `POST /api/actions/<name>/prepare` returning `{ok, preconditions, plan}`; the
   operator confirms; then `POST /api/actions/<name>/execute` with the same
   request id performs it. Executes without a matching confirmed prepare are
   rejected.
3. **Audit**: every prepare/execute writes an append-only JSONL line to
   `factory-control/state/audit.log.jsonl` (server owner, gitignored):
   `{at, action, requestId, operator, ip, unit?, pr?, preconditions, outcome, exit?}`.
4. **Human approval stays mandatory** for destructive/integration actions
   (merge, worktree removal, direct merge). The TUI's confirm is the approval
   point; a recorded `approvedBy` (operator identity) is part of the audit line.

## Actions and guards

| Action | Mechanism | Guard preconditions (from snapshot) |
| --- | --- | --- |
| `worktree/create` | `scripts/factory-worktree.sh create <unit> [base]` | unit has a SPEC file; no `factory/<unit>` branch/worktree already exists; no overlapping writer active on the unit |
| `worktree/remove` | `scripts/factory-worktree.sh remove <unit>` | PR merged **and** CI green on that merge (or explicit `override:true` + confirm); no live agent still acting on the unit |
| `checks/run` | `npm run check` in the unit's worktree (or repo root if no worktree) | worktree exists (or explicit root flag); never runs on the primary checkout when a worktree exists |
| `pr/open` | `gh pr create` (head = `factory/<unit>`, body links the spec and summarizes QA + review + three-way reconciliation) | review handoff present **and** QA handoff present (gate 2); branch exists |
| `ci/watch` | `gh pr checks <pr> --watch` (TUI runs this in a pane; server provides `checks/query` as the polling API) | PR exists |
| `pr/merge` | `gh pr merge <pr> --merge` (squash/merge flag per repo config) | PR open; checks green; review + QA handoffs present; explicit confirm |
| `main/merge` (direct) | merge `factory/<unit>` into `main` | explicit user approval recorded; CI green on the branch; review + QA handoffs present; `override:true` |

Every rejected execute returns `409` with `{error, preconditions: [{name, ok, detail}]}` and does not run the command. All actions return `{requestId, outcome, command, exit, outputTail}` after execution.

### Concurrency

A per-unit lock file (`factory-control/state/locks/<unit>.lock`) prevents
concurrent mutating actions on the same unit (e.g., remove while checks run).
Stale locks (older than 1 h and no live agent) can be released with an explicit
override.

## API surface (server)

- `POST /api/actions/<name>/prepare` body `{unit?, pr?, override?}` → `{requestId, ok, preconditions, plan}`.
- `POST /api/actions/<name>/execute` body `{requestId, confirm: true, approvedBy}` → result or `409`.
- `GET /api/actions/audit?limit=200` → recent audit lines (read-only; operator only via TUI).
- `GET /api/actions/locks` → current lock state.
- Headers: `X-Control-Token` (server-configured token for the TUI; optional on
  localhost, required for remote operator sessions).

## Tests / validation

- Unit: precondition functions over fixture snapshots — assert pass/fail and
  reasons for each guard (including override paths).
- Integration: run against a temp git repo with a fixture unit; verify
  prepare→execute flow works; verify execute without prepare/reject is rejected;
  verify gate violations return 409 and do not run commands; verify audit lines
  are appended with the operator/reason fields.
- Safety: confirm a denied `pr/merge` never touches `gh`; confirm `worktree/remove`
  without merged+green is rejected.

## Acceptance criteria

1. Every action enforces its stated preconditions from the snapshot; violations
   are rejected with 409 and explicit reasons.
2. No mutation executes without a matched confirmed prepare.
3. Audit log records every prepare/execute with outcome; the log is append-only.
4. Per-unit locking prevents overlapping writers/mutations.
5. The web mirror has no route to these endpoints (verified by test).
6. `npm run check` passes with the new workspaces wired.

## Handoff

Builder reports: files changed (action modules, locks, audit, wiring), guards as
implemented, command exit/stdout tails for each executed action in tests, test
coverage, deviations, and the three-way reconciliation. Escalate before changing
guards, allowing web-side execution, or changing the confirm protocol.
