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
  tui/             # M3: pi extension (Factory screen + action menu)
  state/           # runtime state (audit log, dispatch queue) — gitignored
```

Commands: `npm run factory:control -- snapshot [--json]` is the snapshot CLI;
`npm run factory:control -- queue [--json]` lists the M4 dispatch/skill queue;
`npm run factory:control:serve` starts the server (snapshot + web + action
API + dispatch API); the TUI is a pi extension registered in the pi config
(see [`tui/README.md`](tui/README.md)).

## Where the code goes and how it integrates

- npm workspaces `factory-control/server`, `factory-control/web`, and
  `factory-control/tui` are registered in the root `package.json` `workspaces`
  list and in `tsconfig.tests.json` so `npm run check` covers them.
- The TUI extension (`factory-control/tui`) is loaded by pi via the
  project-local shim `.pi/extensions/factory-control.ts` (auto-discovered once
  the project is trusted); it re-exports `@maze/factory-control-tui`.

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
modules and the dispatch module and their unit/integration tests.

## Dispatch & skill triggers (M4)

Operator-driven triggers that help *start* factory work from the control center
while preserving factory authority (decision 6) and the one-executor rule:

- **Dispatch trigger** — turn a unit in the `Spec` stage into a bounded
  delegation request the Lead session picks up and dispatches.
- **Skill trigger** — run skill-guided workflows (e.g. `open-pr`, `qa-tester`,
  `pr-reviewer`) with the resulting agent starting **as a new tab/pane in
  Herdr** (native pi managed-agent behavior).

The control server **never spawns agents**. It only writes a structured request
into a queue; the Lead session (or the human operator) is the one that
delegates (`delegate_agent` / `continue_agent`), so each subagent opens as a
new Herdr pane naturally. Queue entries are *requests*, not commands — the
Lead confirms before dispatching.

### Queue (state)

- `factory-control/state/dispatch-queue/queue.jsonl` — append-only JSONL; one
  line per enqueued entry: `{id, at, unit, specPath, worktree, role, acceptance,
  status}` (+ `skill` / `contextRefs` for skill entries). Lines are never
  rewritten or removed.
- `factory-control/state/dispatch-queue/events.jsonl` — append-only transition
  log (`{id, at, status}`); an entry's current status is derived by replaying
  the events over its creation line, so history is never lost.
- Status transitions: `queued → dispatched → done/cancelled`. The Lead may
  update status explicitly; the server also marks `dispatched` (live agent
  matches the unit) and `done` (a handoff is present) from snapshot evidence.
  Evidence never cancels, reverses, or resurrects terminal entries.

### Endpoints

- `POST /api/dispatch/prepare` body `{unit, skill?}` → validates (unit has a
  SPEC file, no active writer/worktree; for skills, the skill is eligible for
  the unit) and returns `{requestId, entryId, ok, preconditions, plan}` with
  `plan` = suggested role, worktree name (`factory/<unit>`), spec path,
  acceptance summary, and the ready-to-paste delegation prompt. Returns
  `409` `{error}` when an active (queued/dispatched) entry already exists for
  the unit (S2).
- `POST /api/dispatch/enqueue` body `{requestId}` → writes the JSONL entry
  (one-shot requestId) and returns the entry + the delegation prompt. Returns
  `409` `{error, preconditions}` when the prepare did not pass preconditions or
  when the unit gained an active writer/worktree/branch/live-agent (or an
  active queue entry) since prepare — the enqueue re-checks the snapshot
  preconditions, closing the prepare→enqueue TOCTOU (S1).
- `GET /api/dispatch/queue` → `{entries}` (newest last), each enriched with
  its lead prompt; snapshot evidence is applied before listing.
- `POST /api/dispatch/status` body `{id, status}` → explicit Lead transition
  (`queued → dispatched`, `queued → cancelled`, `dispatched → done`,
  `dispatched → cancelled`); invalid transitions are `400`.

All dispatch endpoints use the same operator token gate as the M2 action API
(loopback exempt).

### Skill catalog

`factory-control/server/src/dispatch/skills.ts` defines the bounded skills:

| Skill | Skill file | Suggested role | Eligible when |
| --- | --- | --- | --- |
| `qa-tester` | `.github/skills/qa-tester/SKILL.md` | qa-tester | QA-stage unit (review done) |
| `pr-reviewer` | `.github/skills/pr-reviewer/SKILL.md` | pr-reviewer | Review-stage unit |
| `open-pr` | `.github/skills/open-pr/SKILL.md` | builder | Branch exists, no PR yet |

### Delegation prompt template

The server prints (and the TUI shows) a ready-to-paste prompt for the Lead:

```text
LEAD DELEGATION PROMPT — queue <id>
Unit:       <unit>
Spec:       <specPath>
Worktree:   <worktreePath>   (branch factory/<unit>)
Role:       <role>
Queued:     <at> · status <status>
Skill:      <skill>            (skill entries)
Context:    <contextRefs>      (skill entries)

Acceptance:
  <acceptance>

Dispatch in your pi session with the standard delegation tools, e.g.:

delegate_agent({
  definition: "<role>",
  task: "…",
  files: ["<specPath>", …],
})
```

### TUI surface

- “Dispatch unit” menu item on Spec-stage cards (via the unit's `x` action
  menu) and “Run skill…” items on eligible cards.
- `q` opens the Factory screen's queue view (entries + status).
- Selecting an entry prints the delegation prompt; `c` notifies the copy hint.
- `npm run factory:control -- queue list` is the CLI equivalent for the Lead.

### No-server-spawn guarantee

The dispatch module (`factory-control/server/src/dispatch/`) imports no
`child_process` and executes no commands — its only side effects are append-only
writes to the queue state directory. This is enforced by an integration test
that enqueues and asserts no agents appear in the Herdr root and no subprocess
runner is involved, plus a static source scan for `child_process`/`spawn`.
