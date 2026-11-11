# M1 spec: factory-control web mirror (read-only)

**Status:** Draft — not approved; do not implement until the Lead approves and a
ticket is assigned. · **Workstream:** pacman-256 factory control center (M1)
**Sources:** [brainstorm](factory-control-brainstorm.md),
[M0 snapshot spec](factory-control-snapshot.md), [factory guide](../../docs/FACTORY.md).

## Goal

A **read-only** web mirror of the factory snapshot, served by the factory-control
server and openable by the whole team over LAN. It renders the pipeline board
(kanban), a unit detail pane, and a herd/agent panel. It is the shared *see*
surface; **all actions are operator-side TUI actions (M2/M3) and never appear as
web mutations** (decision 2, 5).

## Out of scope

- Any mutation: no button performs a write; no API endpoint mutates
  (POST/DELETE/PUT on the web surface return 404/405).
- Authentication/RBAC (trust boundary = bind address; see below).
- TUI, actions, triggers.

## Assumptions

- The M0 server exists and exposes `GET /api/snapshot`.
- Stack: Vite + React + TypeScript (mini-app under `factory-control/web/`),
  served as a static build by the control server. Snapshot JSON types are shared
  with the server (a small shared types module).
- Polling every ~5 s is acceptable for team visibility (no websocket required in
  M1; SSE optional later).
- Team access = bind `HOST`/`PORT` via env (default `127.0.0.1:4173`; a teammate
  LAN view sets `HOST=0.0.0.0` — documented in the README as a trust decision).

## UI

### `/` — board

- Columns = stages: `Spec → Dispatch → Execute → Review → QA → Integrate → CI → Done`
  (+ `Unknown`, `Orphaned`).
- Card per unit: slug/id, lane, branch, live agent chips, PR number + check icon,
  diff `±N` + dirty marker, attention badges (blocked, review/QA pending, CI red,
  ready to merge, ready for cleanup, needs dispatch).
- Card click → `/unit/:id`.
- A compact header line summarizes repo branch/dirty, snapshot age, and counts
  (working/blocked/etc.).

### `/unit/:id` — detail

- Spec: title, goal, lane (or `parseError`).
- Git: branch, worktree path, dirty, diff totals, branch switch marker if any.
- Status: PR link, check runs (green/red/pending per check), merged state.
- Trail: ordered handoffs (agent label, definition, time, snippet, result ref) —
  the durable history.
- Attention + suggested next action (**display-only**, with a note like
  “available in the controller TUI”).

### `/agents` — herd panel

- One row per agent: lifecycle glyph + state label, definition, task snippet,
  elapsed, model, thinking, context %, stale/inactive marker.
- Read-only mirror of the Herdr vocabulary; no controls.

### Technical notes

- Client renders from `FactorySnapshot`; on fetch error shows a “control server
  not reachable” state (never a blank crash).
- Mobile-friendly enough to glance on a phone (teammates may use phones).
- No client-side secrets; no auth headers.

## Tests / validation

- Unit: reducer/selectors for stage → column mapping and attention derivation
  (pure functions over fixture snapshots).
- E2E-ish smoke: start server with a fixture snapshot; assert `/` renders cards,
  `/unit/:id` renders trail, `/agents` renders rows; assert every mutating method
  on the web API returns 404/405.
- Manual team check: open from a second machine on LAN; board updates within ~10 s.

## Acceptance criteria

1. `/` shows every unit from the snapshot with its stage column and attention
   badges; orphaned/unknown units are visible, not hidden.
2. `/unit/:id` shows spec, git, PR/checks, and the full handoff trail.
3. `/agents` mirrors live agent lifecycle state and refreshes on poll.
4. Read-only is enforced and verified: no mutating endpoint exists; no UI
   element performs a write; `npm run check` passes.
5. LAN reachable when `HOST=0.0.0.0` (documented trust note); default binds
   localhost.

## Handoff

Builder reports: files changed, how snapshot types are shared, how static assets
are served by the control server, manual LAN verification performed (device +
network), test coverage, deviations, and the three-way reconciliation. Escalate
before adding any web mutation, auth changes, or moving off the M0 snapshot API.
