# U7 spec: TUI board shows issue cards + new issue actions

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Depends on:** U1 shared schema, U2/U3 ingest (snapshot shape), U4/U5 actions (registry + prepare/execute endpoints). · **Surface:** `factory-control/tui/` (selectors, render, screen, keyroutes, fixtures/tests).

## Goal

Extend the `/factory` TUI screen (M3) so issue card units appear on the board, unit detail shows issue fields, and the action menu includes the new issue actions (comment / label / close-reopen / start-work) with the existing lead-prompt view for `factory/start-work`.

## Scope (in)

- Board: issue-seeded and hybrid cards appear in the correct stage columns (same card model; show `#<n>` + title + status label).
- Detail: show issue fields (state, labels, assignees, milestone, updatedAt, body excerpt) and the GitHub URL; open the URL when selected.
- Action menu: add the new actions from unit flags (existing pattern), wiring through `prepare` → plan → `ctx.ui.confirm()` → `execute`; `factory/start-work` opens the existing lead-prompt view (copy hint) on success.
- Selectors/render/screen/fixtures updated; key routing unchanged except new menu entries.

## Out of scope

- Server-side changes, web mirror (U6), Herdr widget changes.

## Acceptance criteria

1. TUI board renders issue cards with `#<n>`/status; detail shows issue fields + URL.
2. New actions appear, flow through prepare/confirm/execute, show guard reasons on rejection; start-work opens the lead-prompt view.
3. TUI tests updated and passing; `npm --workspace factory-control/tui run typecheck` + tests + build pass; full `npm run check` green.

## Validation

Inside the worktree: `npm --workspace factory-control/tui run typecheck`, `npm --workspace factory-control/tui test`, `npm run build`, `npm run check`; manual `/factory` smoke against a running server if feasible.

## Handoff

Builder reports: selectors/render/screen changes, action wiring, tests, risks, three-way reconciliation.
