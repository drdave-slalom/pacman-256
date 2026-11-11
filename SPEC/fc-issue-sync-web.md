# U6 spec: web mirror renders issue cards + new issue actions

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Depends on:** U1 shared schema, U2/U3 ingest (snapshot shape), U4/U5 actions (registry + prepare/execute endpoints). · **Surface:** `factory-control/web/` (state/selectors, components, fixtures/tests).

## Goal

Make the read-only web mirror (M1) show GitHub issue cards on the board (including issue-seeded and hybrid units) and expose the new issue actions (comment / label / close-reopen / start-work) through the existing prepare/execute action API — same pattern as today's action menu.

## Scope (in)

- Board: units with `kind: "issue"`/`"hybrid"` render in the stage columns like spec units (cards show title, `#<n>`, status label, blocked marker).
- Detail: issue fields (state, labels incl. type/role/lane/status, assignees, milestone, updatedAt, body excerpt) displayed; link to the GitHub URL.
- Actions: the action menu derives from unit flags (existing pattern); add entries for `github/issue-comment`, `github/issue-label`, `github/issue-state`, `factory/start-work` with the appropriate input forms (comment text / labels / state), wired to `prepare` then `execute` (confirm). Respect 409 guard reasons display as today.
- Selectors/fixtures updated for the new fields; no changes to the server API shape.

## Out of scope

- Server-side changes, TUI (U7), changing existing actions.

## Acceptance criteria

1. Web mirror renders issue-seeded and hybrid cards with issue fields; a card opens detail with the GitHub URL.
2. New actions appear and flow through prepare/execute/confirm; rejected rows show guard reasons.
3. Selector/component tests updated and passing; web workspace typecheck + build pass; full `npm run check` green.

## Validation

Inside the worktree: `npm --workspace factory-control/web run typecheck`, `npm --workspace factory-control/web test`, `npm run build`, `npm run check`; manual smoke of the web app against a running server if feasible.

## Handoff

Builder reports: components/selectors changed, action wiring, test results, risks, three-way reconciliation.
