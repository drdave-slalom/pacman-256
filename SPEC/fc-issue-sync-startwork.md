# U5 spec: start-work action (issue card → spec scaffold + branch/worktree + enqueued dispatch)

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Depends on:** U2/U3 ingest (issue cards `kind:"issue"`/`"hybrid"`, `Unit.issue`), existing M4 dispatch queue (`factory-control/server/src/dispatch/service.ts`), existing `worktree/create` action primitives. · **Surface:** `factory-control/server/src/actions/actions.ts`, `preconditions.ts`, `dispatch/service.ts` (enqueue API), tests.

## Goal

From an issue card, let the Lead start factory work in one guarded action: derive a unit id, scaffold `SPEC/<id>-<slug>.md` from the issue, create the `factory/<unit>` branch + worktree, and enqueue an M4 dispatch request (role from labels, lead prompt ready to copy). The server never spawns agents — it prepares the delegation request; the Lead copies/dispatches it.

## Scope (in)

New action **`factory/start-work`** (mutates), target = a unit carrying `issue` with no `specPath` and no `branch` yet:

1. **Derive unit id:** if the issue title starts with a unit token (`T<n>` or `fc-…`/`<slug>` prefix), use it; else `issue<n>` (n = issue number). Slug from title (lowercased, dashed).
2. **Scaffold spec:** write `SPEC/<id>-<slug>.md` with H1 = title, `**Status:** Draft — start-work scaffold from #<n>.`, Goal = issue body excerpt, acceptance placeholders, tracker link `#<n>`. (Writer runs in the action's cwd = factory root; file write via node fs in the action step.)
3. **Create branch + worktree:** reuse the `worktree/create` step (`scripts/factory-worktree.sh create <id>`).
4. **Enqueue dispatch:** append an M4 queue request via the dispatch service: role profile from `issue.labels.role` (first role label) default `builder`; spec path; acceptance = scaffolded expectations; lead prompt = the delegation prompt for the Lead to copy.

Preconditions: unit-found + has issue; no existing specPath/branch for the derived id; gh available (issue exists); no live agent; confirm required; per-unit lock; audit.

Tests: with mock runner + dispatch stub, assert the exact sequence (spec file written, worktree create invoked with derived id, queue enqueued with role/lead-prompt); denied paths never write files or invoke commands; unknown/invalid inputs.

## Out of scope

- Actually spawning agents (never), GitHub write-back actions (U4), UI wiring (U6/U7), changing the dispatch queue semantics.

## Acceptance criteria

1. `factory/start-work` runs the sequence in order and returns a plan/prompt the Lead can copy.
2. Guards deny when unit has no issue, already has spec/branch, gh unavailable, live agent present, or unconfirmed — deny writes nothing.
3. Enqueued request carries the derived unit id, spec path, role, and lead prompt; server spawns nothing.
4. Tests pass; existing action + dispatch tests still pass; `npm run check` green.

## Validation

Inside the worktree: `npm test` (actions + dispatch suites), `npm run typecheck`, `npm run build`, `npm run check`.

## Handoff

Builder reports: derived-id and slug rules, scaffold template, step sequence, dispatch-enqueue shape, tests, risks, three-way reconciliation.
