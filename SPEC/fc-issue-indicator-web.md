# Spec: Web UI — GitHub logo indicator on issue-populated cards

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59) (feature umbrella). · **Surface:** `factory-control/web/` (`src/components/UnitCard.tsx`, `src/styles.css`, tests). · **Baseline:** main after U1/U2-3/U4-5/U6/U7 merged.

## Goal

On the web mirror board, make it immediately obvious which cards come from GitHub issues: render a small GitHub logo mark on the card for any unit that carries an attached issue (issue-seeded `kind:"issue"` or linked `kind:"hybrid"`). Spec-only units are unchanged.

## Scope (in)

- `UnitCard.tsx`: when `unit.issue` is present, render a GitHub logo indicator (inline SVG mark — a minimal octocat-style or GitHub-mark glyph — not an external image asset; keep it small, positioned as a source badge next to the `#<n>` chip).
- `styles.css`: style the logo badge (size, alignment, muted color) consistent with existing chips.
- Update/extend component render tests (integration.render.test.ts) to assert the badge renders for issue-seeded and hybrid cards and is absent for spec-only cards.

## Out of scope

- TUI `[GitHub]` tag (separate unit), server/snapshot changes, action menu changes, adding binary image assets.

## Acceptance criteria

1. Web card shows a GitHub logo badge for every unit carrying `issue` (standalone + hybrid); spec-only cards show none.
2. Web tests updated and passing; typecheck, build, and smoke pass.
3. Full `npm run check` green.

## Validation

Inside the worktree: `npm --workspace factory-control/web run typecheck`, `npm --workspace factory-control/web test`, `npm --workspace factory-control/web run build`, `npm --workspace factory-control/web run smoke`, `npm run check`.

## Handoff

Builder reports: files changed, exact component change, tests, risks, three-way reconciliation.
