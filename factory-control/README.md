# Factory Control Center

This folder is the single home for the **factory control center** workstream: a
hybrid operator/team surface for visualizing and (safely) driving the pacman-256
software factory.

Per user direction, **all** work for this workstream lives here — specs and
future code — instead of the repo-root `SPEC/` and `apps|packages/` conventions.

## Decisions (from the brainstorm, resolved)

| # | Decision |
| --- | --- |
| 1 | **Surface:** hybrid — operator TUI inside pi + read-only web mirror for the team over LAN. |
| 2 | **Action scope:** view-only board, GitHub PR/CI actions, worktree/branch actions, skill & delegation triggers. |
| 3 | **Audience:** whole team, shareable (web mirror is the shared read surface; TUI is the operator surface). |
| 4 | **Stage detection: pure inference** — no manual status tags added to SPEC files. |
| 5 | **Web mirror is strictly read-only** (no mutation endpoints at all); every action is an operator-side TUI action. |
| 6 | **Skill/delegation triggers are operator-driven only**; subagents start as a new tab/pane in Herdr — never spawned by the control server. |
| 7 | Human approval remains mandatory for destructive/integration actions (merge, worktree removal). |

Source: [`SPEC/factory-control-brainstorm.md`](SPEC/factory-control-brainstorm.md).

## Architecture

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│  pi session (operator)      │      │  Web mirror (team, browser)  │
│  ┌───────────────────────┐  │      │  Vite/React static bundle     │
│  │ TUI extension         │  │      │  kanban · detail · agents    │
│  │ Factory screen        │  │      └──────────────┬───────────────┘
│  │ action menu           │  │                     │ GET /api/snapshot
│  │ (Herdr widget reused) │  │                     ▼
│  └───────────────────────┘  │      ┌──────────────────────────────┐
│         │                    │      │  factory-control server      │
│         │ api (local)        │      │  (Node + TS)                │
└─────────┼────────────────────┘      │  aggregate → snapshot        │
          │                           │  action endpoints (guarded) │
          ▼                           │  serve web static            │
   ┌────────────────────┐             └──────────────┬───────────────┘
   │ Herdr state + git +│◄── read ───────────────────┘
   │ gh + SPEC           │
   └────────────────────┘
```

- **Server** (`factory-control/server/`): the single aggregator; owns the
  snapshot model, guarded action API, audit log, and web static hosting.
- **Web** (`factory-control/web/`): read-only mirror (M1).
- **TUI** (`factory-control/tui/`): pi extension (M3) that reads the snapshot and
  is the only action surface (M2, M4).
- **State** (`factory-control/state/`): runtime state (audit log, dispatch
  queue) — gitignored.

## Component map

| Milestone | Spec | What it delivers |
| --- | --- | --- |
| M0 | [`SPEC/factory-control-snapshot.md`](SPEC/factory-control-snapshot.md) | Snapshot core: aggregate Herdr + git + gh + SPEC into one model with pure-inference stages; CLI + smoke tests. |
| M1 | [`SPEC/factory-control-web-mirror.md`](SPEC/factory-control-web-mirror.md) | Read-only web mirror: kanban, unit detail, herd panel; LAN-servable. |
| M2 | [`SPEC/factory-control-actions.md`](SPEC/factory-control-actions.md) | Guarded actions API: worktree create/remove, open PR, watch CI, approve/merge; audit log. |
| M3 | [`SPEC/factory-control-tui.md`](SPEC/factory-control-tui.md) | pi TUI extension: Factory screen + action menu; reuses Herdr widget/pane focus. |
| M4 | [`SPEC/factory-control-triggers.md`](SPEC/factory-control-triggers.md) | Operator-driven skill & delegation triggers; subagents start as new panes in Herdr. |

Dependencies: M1 depends on M0; M2 depends on M0; M3 depends on M0 + M2; M4
depends on M0 and the Lead-session workflow.

## Planned layout (specs now, code later)

```
factory-control/
  README.md
  SPEC/            # this workstream's specs (brainstorm + M0–M4)
  tickets/         # work items M0–M4 (ticket-format, tracked here as files)
  server/          # M0 + M2: snapshot aggregation + guarded action API
  web/             # M1: read-only Vite/React mirror
  shared/          # canonical snapshot types (server + web)
  tui/             # M3: pi extension
  state/           # runtime state (audit log, dispatch queue) — gitignored
```

Planned commands (defined when code lands): `npm run factory:control -- snapshot
[--json]` is the snapshot CLI; `npm run factory:control:serve` starts the server
(snapshot + web + action API); the TUI is a pi extension registered in the pi
config.

## Where the code goes and how it integrates

- New npm workspaces `factory-control/server` and `factory-control/web` are added
  to the root `package.json` `workspaces` list and to `tsconfig.tests.json` so
  `npm run check` covers them. (Implementation detail; confirm during build.)
- The TUI extension is a pi extension package (`factory-control/tui`) loaded by
  the pi config.

## Implementation route (factory gates apply)

Each spec is a bounded unit: write it → export worktree via
`scripts/factory-worktree.sh create <unit>` → delegate to the matching role
(`builder` for implementation) → `qa-tester` + `pr-reviewer` must pass before
any PR/merge → watch CI (`gh pr checks <pr> --watch`) → remove the worktree
only after CI green + merged. The Lead does not implement; humans approve.

## Web mirror (M1)

The read-only web mirror lives in [`web/`](web/README.md) and is served by the
control server as a static build (same process that serves `GET /api/snapshot`).
It renders the pipeline as a kanban (`/`), a unit detail page (`/unit/:id`),
and the herd panel (`/agents`). It polls the snapshot every ~5 s and is
**strictly read-only**: it issues no writes, and every mutating method on the
web surface returns 404/405. The one exception to "no POST anywhere" is the
pre-existing M0 endpoint `POST /api/refresh` (server-side snapshot cache
re-read): it mutates no state and the web UI never calls it.

**Bind address (trust decision).** The server defaults to
`127.0.0.1:4780` (`HOST`/`PORT` env). To let teammates open the mirror from
another machine on LAN, run `HOST=0.0.0.0 npm run factory:control:serve` and
browse to `http://<your-lan-ip>:4780/`. Binding `0.0.0.0` exposes the API and
mirror to the whole network — there is no auth (M1), so treat it as a trusted
LAN-only decision. The Vite dev server (for UI iteration) defaults to
`127.0.0.1:4173` and proxies `/api` to the control server.

**Build/serve:** `npm run build` builds the web workspace; the control server
serves `factory-control/web/dist` automatically (SPA fallback included).
Smoke: `npm run factory:web:smoke`.

## Guarded actions API (M2)

The server exposes a guarded **action API** for the operator-side TUI (M3). It
is the only surface that mutates git/GitHub/scripts; the web mirror is
strictly read-only and never calls these endpoints. Every mutation goes
through a two-step `prepare` → `execute` protocol with gate preconditions
computed from the snapshot, per-unit locks, and an append-only audit log.

### Endpoints

- `POST /api/actions/<name>/prepare` body `{unit?, pr?, override?, root?}`
  → `{requestId, ok, preconditions, plan}` (`preconditions` = `[{name, ok,
  detail}]`; `root:true` is accepted by `checks/run` only).
- `POST /api/actions/<name>/execute` body `{requestId, confirm: true, approvedBy}`
  → `{requestId, outcome, command, exit, outputTail}`; gate violations return
  `409` with `{error, preconditions}` and never run the command.
- `GET /api/actions/audit?limit=200` → recent audit lines (newest last).
- `GET /api/actions/locks` → current lock state.

Actions: `worktree/create`, `worktree/remove`, `checks/run`, `pr/open`,
`checks/query` (the polling API behind the TUI's `ci/watch` pane), `pr/merge`,
and `main/merge` (direct, requires `override:true`). Guards are listed in
[SPEC/factory-control-actions.md](SPEC/factory-control-actions.md) and are
computed from the snapshot at both prepare and execute time. `main/merge`
runs `git fetch origin` and a clean-tree check (`git diff --quiet HEAD`) before
`git checkout main`, so stale local refs cannot produce a wrong/failed merge.

Unit ids are validated against `/^[a-z0-9._-]+$/i` and canonicalized before
they flow into subprocess args, branch/script names, or lock keys; `pr` must
be a positive integer. Invalid input is rejected with 400.

### Operator token

Remote operator sessions require the `X-Control-Token` header matching the
server-configured token (`FACTORY_CONTROL_TOKEN` env). Localhost sessions are
exempt (token optional). With no token configured, remote action sessions are
denied (`503`).

### State (gitignored)

- `factory-control/state/audit.log.jsonl` — append-only JSONL: `{at, action,
  requestId, operator, ip, unit?, pr?, preconditions, outcome, exit?}`.
- `factory-control/state/locks/<unit>.lock` — per-unit lock files; stale locks
  (>1 h, or held by a dead pid) are releasable with `override:true`.

Build/test: `npm run check` covers the server workspace, including the action
modules and their unit/integration tests.
