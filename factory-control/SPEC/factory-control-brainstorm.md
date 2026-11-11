# Factory Control Center — Brainstorm Proposal

Status: **proposal** (brainstorm), not yet an implementation spec.

## Goal

A **control center** for the pacman-256 software factory: visualize units flowing
through the pipeline and let an operator act on them (worktrees, PRs/CI, and
wiring to Lead sessions/skills). Per the agreed direction:

- **Surface:** hybrid — an operator **TUI inside pi** (reusing Herdr's pane
  management) plus a **read-only web mirror** the whole team can open over LAN.
- **Actions:** view-only status board, GitHub PR/CI actions, worktree & branch
  actions, and skill/delegation triggers.
- **Audience:** whole team, shareable (web mirror is the shared surface; TUI is
  the operator surface).

## Principles

1. **Observation first, action second.** The factory already produces nearly all
   the data we need (specs, worktrees, PRs, CI, agent handoffs). The control
   center reads it; it mutates only through guarded, gate-aware actions.
2. **Herdr stays the pane/session authority.** The TUI reuses the live status
   widget and click-to-focus pane navigation. We do not duplicate or fight
   Herdr control; we add a factory board around it.
3. **One-executor rule is respected.** The control center never bypasses
   ownership or gates. Delegation remains a Lead-session action; the control
   center surfaces readiness and (optionally) queues a dispatch request the Lead
   confirms.
4. **Fail-open to “unknown”.** Herdr's internal on-disk state is an internal
   implementation detail and changes between versions. Reads are defensive and
   tolerate missing/new fields; unreadable state renders as `unknown`, never a
   crash.
5. **Human approval remains mandatory** for destructive/integration actions
   (merge, worktree removal, direct merges).

## Sources of truth (read path)

| Data | Source | Notes |
| --- | --- | --- |
| Live agents & states | Herdr `list_agents` (TUI) / `runtime/mailboxes-v5` + peer files (web) | ephemeral; reconcile with durable results |
| Agent handoffs | Herdr `results/` (per-agent files incl. session metadata) | durable; keep forever as the unit trail |
| Evidence / result refs | Herdr `evidence/`, `result-ref-reservations/` | link result refs back to units |
| Units | `SPEC/*.md` | parse title, goal, acceptance criteria; optional stage tag |
| Worktrees / branches | `git worktree list`, `git branch --list 'factory/*'` | per-unit diff stats vs `main` |
| PRs / checks / CI | `gh pr list`, `gh pr checks`, `gh run list` | uses existing `gh` auth |
| Scripts | `scripts/factory-worktree.sh`, `scripts/factory-setup.sh`, `npm run check` | invoked only via guarded actions |

## Architecture (hybrid)

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
│         │ api (local)        │      │  (Node + TS, in monorepo)   │
└─────────┼────────────────────┘      │  aggregate → snapshot        │
          │                           │  action endpoints (guarded) │
          ▼                           │  serve web static            │
   ┌────────────────────┐             └──────────────┬───────────────┘
   │ Herdr state + git +│◄── read ───────────────────┘
   │ gh + SPEC + scripts │
   └────────────────────┘
```

- **factory-control server**: a small Node/TS process in the monorepo
  (`apps/factory-control`), the single aggregator and the source of both
  surfaces. Binds localhost for the operator; binds LAN for the team mirror.
  Read-only endpoints are open; action endpoints require a token + confirmation.
- **TUI extension**: a pi extension built on `@earendil-works/pi-tui`
  (`ctx.ui.custom()` screen + optional `ctx.ui.setWidget()` summary strip). It
  reads the same snapshot and can run guarded actions with an interactive
  confirm in the pi TUI. The Herdr status widget remains the agent pane manager.

## View model

### Pipeline board (kanban)

Columns per `docs/FACTORY.md` stages:
`Spec → Dispatch → Execute → Review → QA → Integrate → CI → Done`.

Each card = one unit:

- slug/id, role lane, worktree branch;
- live agent label(s) currently executing it;
- PR number + checks icon (green/red/pending);
- diff `±N` vs `main` (net tracked lines) + dirty marker;
- latest handoff snippet + result ref;
- “needs attention” flag: blocked agent, review/QA pending, CI red, PR ready to
  merge, worktree ready for removal.

Stage is **inferred** (branch exists? PR open? checks green? handoff in
results? worktree still present?) with a TBD inference table, plus an optional
manual override/tag in the UI.

### Detail pane (select a card)

- Spec excerpt: goal + acceptance criteria.
- Git: branch, worktree path, diff stats, commits.
- Status: PR link, check runs, CI run(s).
- Trail: ordered agent handoffs (`results/`) + result refs; timeline.
- Suggested next action (gated), e.g. *Review now*, *Open PR*, *Merge (after
  gates)*, *Remove worktree*.

### Herd / agent panel

Same lifecycle vocabulary as Herdr (`working`/`blocked`/`settling`/`unknown`/
`lost`) plus per-agent: task, elapsed, model, thinking, context %, inactivity,
available control actions (**display-only** in the web; actionable/focusable in
the TUI).

### Activity log / timeline

Appended event stream derived from Herdr evidence + git + gh, persisted by the
server so history survives mailbox cleanup.

## Action model (guarded)

Every action logs (who, what, when, outcome). All mutating actions require the
operator role and gate preconditions computed from the snapshot.

| Action | Mechanism | Guards |
| --- | --- | --- |
| Create worktree | `scripts/factory-worktree.sh create` | spec exists; no overlapping writer |
| Remove worktree | `scripts/factory-worktree.sh remove` | merged + CI green (explicit override otherwise) |
| Run checks | `npm run check` (in worktree / cwd) | read/exec only |
| Open PR | `gh pr create` (or `open-pr` skill path) | review + QA recorded |
| Watch CI | `gh pr checks <pr> --watch` | — |
| Approve / merge | `gh pr merge` (or direct merge with approval) | review + QA + CI green; explicit confirm |
| Invoke a skill | open skill doc / headless pi run / delegation trigger | bounded; one-executor respected |

**Delegation is never spawned from the server.** It remains a Lead-session
action. The control center either (a) instructs the operator (open the right
delegation in the pi session) — recommended for v1 — or (b) queues a structured
“dispatch request” into the Lead session that the Lead must confirm.

## Tech choices

- Server: Node ≥22 + TypeScript; minimal deps (hono or `node:http`); npm
  workspace `apps/factory-control`; shared snapshot schema types.
- Web mirror: Vite + React + TS mini-app; served by the control server.
- TUI: pi extension using `@earendil-works/pi-tui` (custom screen + widget);
  configured via pi extensions; lives in the repo.
- Repo plumbing: `npm run factory:control` script; snapshot CLI (prints JSON)
  for headless verification.

## Milestones

- **M0 — Snapshot core:** server aggregates Herdr (results/evidence/mailboxes)
  + git (worktrees/branches) + gh (PRs/checks) into one snapshot; CLI prints it;
  smoke tests lock the read path.
- **M1 — Web mirror (read-only):** kanban + detail + agent panel; LAN bind;
  team-reachable.
- **M2 — Guarded actions:** worktree create/remove, open PR, watch CI,
  approve/merge with gate checks + confirm + audit log.
- **M3 — TUI extension:** factory screen + action menu in the pi session;
  reuse Herdr widget/pane focus.
- **M4 — Skill & delegation triggers:** `open-pr` integration; dispatch-request
  queue to the Lead session.

## Open questions (resolve before speccing)

1. **Stage inference vs manual tag.** Recommend adding an optional `status:`
   frontmatter field to SPEC files (authoritative, simplest) and using
   inference only as fallback.
2. **Local auth:** how the TUI authenticates to the server (localhost trust) and
   what token gates the web action endpoints. Recommend v1 = web is read-only,
   actions live in the TUI.
3. **Headless pi invocation** for “invoke skill” — feasibility/limits.
   Recommend v1 = operator-driven (no headless runs).
4. **Concurrency:** v1 assumes a single operating Lead; revisit if multiple
   Leads run against one repo.
5. **State replay:** keep the server's event log authoritative for history since
   Herdr mailboxes are ephemeral.

## Definition of done for this brainstorm

Agree on: surface split (done), action scope (done), guards, data-source
mapping, and milestone order. Then write implementation specs (e.g.
`SPEC/factory-control-server.md`, `SPEC/factory-control-tui.md`) and tickets,
and build through the factory gates (builder implements; qa-tester and
pr-reviewer verify before any PR/merge).
