# M4 spec: factory-control skill & delegation triggers (operator-driven)

**Status:** Draft — not approved; do not implement until the Lead approves and a
ticket is assigned. · **Workstream:** pacman-256 factory control center (M4)
**Sources:** [brainstorm](factory-control-brainstorm.md),
[M0 snapshot spec](factory-control-snapshot.md),
[M2 actions spec](factory-control-actions.md), [factory guide](../../docs/FACTORY.md)
(one-executor rule, Lead authority, gates).

## Goal

Operator-driven triggers that help *start* factory work from the control center,
while preserving factory authority (decision 6):

1. **Dispatch trigger** — turn a unit in the `Spec` stage into a bounded
   delegation request that the Lead session picks up and dispatches.
2. **Skill trigger** — run skill-guided workflows (e.g. the `open-pr` flow)
   with the resulting agent starting **as a new tab/pane in Herdr** (native pi
   managed-agent behavior).

The control server **never spawns agents itself**. It only writes a structured
request into a queue; the Lead session (or the human operator) is the one that
delegates, so the agent appears as a new Herdr pane naturally (one-executor rule
and Lead ownership preserved).

## Out of scope

- Direct agent launching from the server or web.
- Automating human/Lead approval (queue entries are requests, not commands).
- Changing Herdr or pi delegation semantics.

## Assumptions

- Delegation happens through the Lead session's standard tools
  (`delegate_agent` / `continue_agent`), which already start managed agents that
  appear as new panes in the pi TUI/Herdr. The control center's job is to
  *prepare the request* (spec path, worktree, role, acceptance criteria) and
  surface it for the Lead to confirm and dispatch.
- The queue is a local JSONL file (`factory-control/state/dispatch-queue/queue.jsonl`)
  + per-entry state files; it is machine-readable by both the TUI extension and a
  small helper command the Lead can run (e.g. `npm run factory:control -- queue list`).

## Flow

### Dispatch trigger

1. TUI action “Dispatch unit” on a `Spec`-stage unit calls
   `POST /api/dispatch/prepare {unit}` → server validates the unit has a SPEC
   file and no active worktree/writer, and returns a plan: role suggestion
   (from lane/content), worktree name (`factory/<unit>`), spec path, expected
   handoff and acceptance criteria summary.
2. Operator confirms → `POST /api/dispatch/enqueue {requestId}` writes a queue
   entry:
   ```jsonc
   {
     "id": "req-…", "at": "…", "unit": "…",
     "specPath": "SPEC/…", "worktree": "factory/<unit>",
     "role": "builder",      // suggestion only
     "acceptance": "…", "status": "queued"
   }
   ```
3. The Lead (in its pi session) either polls the queue (`queue list`) or the TUI
   shows the queued entry with a “Hand to Lead” hint. The Lead delegates with the
   standard tools; the agent starts as a new Herdr pane. The entry status is set
   to `dispatched` when the Lead marks it (or when the snapshot detects a live
   agent matching the unit).
4. When the agent completes, M0's result read attaches the handoff to the unit —
   the card moves forward and the queue entry closes (`done`).

### Skill trigger

1. TUI action “Run skill …” (e.g. `open-pr` for an `Integrate`-stage unit, or a
   role skill like `qa-tester`/`pr-reviewer` for validation) prepares a bounded
   skill request referencing the skill's SKILL.md and the unit context.
2. The operator confirms; the server enqueues a skill request (same queue shape
   plus `skill` and `contextRefs`).
3. The Lead executes the skill by delegating to the matching role agent in the pi
   session — again, the agent appears as a new Herdr pane. The control center
   does not run the skill itself.

### Queue honesty

- Entries never auto-execute. Status transitions: `queued → dispatched → done`
  (or `cancelled`). Server-side automation only marks `dispatched`/`done` from
  snapshot evidence (live agent match; handoff present); the Lead may also update
  status explicitly.

## API + TUI surface

- Server: `POST /api/dispatch/prepare`, `POST /api/dispatch/enqueue`,
  `GET /api/dispatch/queue`, `POST /api/dispatch/status {id, status}`.
- TUI: menu items “Dispatch unit” and “Run skill…” on eligible cards; queued
  entries listed in the Factory screen with status; a “copy lead prompt” helper
  that prints the ready-to-use delegation prompt (spec + worktree + acceptance)
  for the Lead to paste/use.

## Tests / validation

- Unit: queue state transitions (queued/dispatched/done/cancelled); prepare
  validation (reject when worktree/writer already exists); snapshot-evidence
  transition logic.
- Integration (temp dir): enqueue a unit; assert no agent/process is spawned by
  the server; assert the entry is JSONL-persisted and listable; simulate the Lead
  marking `dispatched` and a fixture handoff closing it to `done`.
- Manual: in the pi session, run the dispatch flow for a stub unit and confirm
  the resulting agent opens as a new Herdr pane; run the `open-pr` skill trigger
  on a fixture PR-ready unit and confirm the agent pane + resulting PR.

## Acceptance criteria

1. The server never spawns agents; it only records queue entries and evidence.
2. Prepare rejects units already under active work/writers.
3. Every entry persists and transitions only through the allowed statuses; the
   audit/queue log is append-only.
4. A dispatched unit in the snapshot shows a live agent row and later a handoff,
   closing the entry.
5. The resulting agent appears as a new tab/pane in Herdr (verified in manual
   smoke).
6. `npm run check` passes.

## Handoff

Builder reports: files changed (queue module, endpoints, TUI menu wiring), the
exact prompt template handed to the Lead for delegation, manual smoke results
(dispatch → new Herdr pane → handoff), test coverage, deviations, and the
three-way reconciliation. Escalate before any server-side delegation, changing
queue semantics, or bypassing Lead confirmation.
