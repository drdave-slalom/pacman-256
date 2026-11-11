# Factory spec: factory-control bidirectional GitHub issue sync + start-work action

**Status:** Approved by Lead + user (scope confirmed 2026-11-11). · **Tracker:**
[#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Type:**
feature — factory-control platform (M0 snapshot / M2 actions / M1 web / M3 TUI).

## Goal

Give the factory-control platform two-way GitHub Issues sync so the factory can
ingest and later work on GitHub issues:

1. **Ingest:** open (and optionally closed) repository issues become first-class
   board cards on the factory-control snapshot — number, title, state, url,
   labels (`type:*`, `role:*`, `lane:*`, `status:*`, `blocked`, `follow-up`,
   `playtest`), assignees, milestone, created/updated timestamps.
2. **Link:** issue cards link to existing SPEC-file units when a spec or PR
   references the issue via `Closes #N` (or an issue-number match); issues with
   no linked unit are standalone cards.
3. **Write-back (bidirectional):** guarded M2 actions can comment on, relabel,
   close/reopen an issue via `gh`, audited and gated like every other M2 action.
4. **Start-work:** a guarded action on an issue card scaffolds
   `SPEC/<id>-<slug>.md` from the issue, creates a `factory/<unit>` branch +
   worktree, and enqueues an M4 dispatch request (the server never spawns
   agents — it prepares the delegation plan/prompt for the Lead to copy).

## Units

| Unit | Concern | Surface | Wave |
| --- | --- | --- | --- |
| U1 `fc-issue-sync-shared` | Shared schema/types for issue cards + unit linking | `factory-control/shared`, `server/src/types.ts` | A0 |
| U2 `fc-issue-sync-reader` | GitHub issues reader (`gh issue list`) w/ defensive parse | `server/src/github.ts` | A1 |
| U3 `fc-issue-sync-snapshot` | Snapshot integration + stage inference + spec/PR link | `server/src/snapshot.ts`, `infer.ts`, `markdown.ts` | A1 |
| U4 `fc-issue-sync-actions` | Write-back actions (comment/label/close/reopen), guarded + audited | `server/src/actions/` | B |
| U5 `fc-issue-sync-startwork` | Start-work trigger (spec scaffold + branch/worktree + enqueue) | `server/src/actions/`, `service.ts` | B |
| U6 `fc-issue-sync-web` | Web mirror renders issue cards + new actions | `factory-control/web/` | B |
| U7 `fc-issue-sync-tui` | TUI board shows issue cards, detail, action menu | `factory-control/tui/` | B |

Wave A0 must land before A1 (reader/snapshot build on the schema). Wave B runs
in parallel after A0+A1 land (UI consumes the snapshot shape + action registry).

## Feature-level acceptance

- Snapshot lists open GitHub issues as cards with core fields + labels.
- Issue cards link to SPEC units referenced via `Closes #N`; unmatched issues are
  standalone cards (and any unmatched issue artifacts surface honestly).
- Guarded M2 actions can comment, label, close/reopen an issue; require gh auth +
  per-unit lock; audited.
- Start-work on an issue card scaffolds a spec, creates branch + worktree, and
  enqueues a dispatch request; server never spawns agents.
- Web mirror and TUI render issue cards and the new actions.
- New shared/server/web/tui tests pass; `npm run check` green; smoke tests updated.

## Validation

Per unit: targeted unit tests in `npm test`, `npm run typecheck`, `npm run
build` (and `npm run check` at the end) inside the unit's worktree. Reader unit
uses `gh` against the real repo with defensive fallbacks. Actions unit verifies
prepare/deny paths (never touch GitHub on denied).

## Handoff

Each writer reports: files changed, test results, behavior notes (gh field
shapes, defensive parse outcomes), risks, three-way reconciliation (spec /
change / tests). Lead integrates per factory pipeline (review → QA → PR → CI).
