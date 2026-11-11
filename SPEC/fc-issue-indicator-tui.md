# Spec: TUI — prominent "[GitHub]" indicator on issue-populated cards

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59) (feature umbrella). · **Surface:** `factory-control/tui/` (`src/render.ts`, tests, README). · **Baseline:** main after U1/U2-3/U4-5/U6/U7 merged.

## Goal

On the `/factory` TUI board, make it immediately obvious which cards come from GitHub issues: render a prominent `[GitHub]` tag on the card line for any unit that carries an attached issue (issue-seeded `kind:"issue"` or linked `kind:"hybrid"`). Spec-only units are unchanged.

## Scope (in)

- `render.ts` `cardLine`: when `unit.issue` is present, append a `[GitHub]` tag to the card line (alongside the existing `#<n>` title/status rendering). Style distinct from stage/status text (e.g., bracketed tag, dim/highlight color) so it reads as a source badge.
- Update rendering tests (render.test.ts) to assert: issue-seeded card shows `[GitHub]`; hybrid card shows `[GitHub]`; spec-only card does not.
- Update `README.md` usage note (one line) if it describes card rendering.

## Out of scope

- Web UI logo (separate unit), server/snapshot changes, action menu changes, key routing.

## Acceptance criteria

1. TUI board shows `[GitHub]` on every card whose unit carries `issue` (standalone + hybrid); spec-only cards show no marker.
2. Existing TUI tests still pass; new render tests cover the three cases.
3. `npm --workspace factory-control/tui run typecheck` + tests + build pass; full `npm run check` green.

## Validation

Inside the worktree: `npm --workspace factory-control/tui run typecheck`, `npm --workspace factory-control/tui test`, `npm run build`, `npm run check`.

## Handoff

Builder reports: files changed, exact render line change, tests, risks, three-way reconciliation.
