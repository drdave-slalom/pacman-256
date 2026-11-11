# Factory spec: Closed issues always visible on the factory board (TUI + web)

**Status:** Draft (amends the earlier "toggle" spec) — for builder execution. · **Workstream:** factory control center (issue visibility).
**Sources:** user request (make it always on — no toggle), prior toggle implementation (merged #80).

## History

The initial implementation (`fc-issues-toggle`, PR #80) added a "show closed issues" toggle (TUI `i`, web checkbox). The user reports the TUI toggle did not appear (their pi session predates the merge and still runs the old extension), and prefers **no toggle at all**: closed issues should just always be shown. This spec replaces the toggle with always-on behavior.

## Goal

Closed issues that are not already represented by a unit card are always visible in the factory board on both surfaces — no toggle, no keybinding, no checkbox. Open-issue cards, hybrid units, and Orphaned behavior are unchanged.

## Scope (in)

- **TUI** (`factory-control/tui/src/`):
  - `screen.ts`: remove `showClosed` state and `toggleClosedIssues()`; always pass `closedUnmatchedIssues(snapshot)` to the board body render.
  - `keyroutes.ts`: remove the `i`/`I` route and the op (restore prior key set: a/x/r/s/q/c).
  - `render.ts`: `renderBoardBody` always appends the `Closed issues (N)` section (after Orphaned) when non-empty; keep `renderClosedIssues`; update the help hint to drop `· i closed on/off`.
  - Tests: update screen/render/keyroutes tests — no toggle; section always present when closed-unmatched issues exist, absent when none.
- **Web** (`factory-control/web/src/`):
  - `components/Board.tsx`: remove the checkbox and local toggle state; always render the `.column-issues` section after Orphaned when non-empty.
  - `ssr.ts`/`renderBoardContent`: drop the `showClosed` parameter (or default it to true and remove the call-site toggle).
  - Tests: Board render tests — no toggle; section always rendered when closed-unmatched exist, absent when none.
- Keep `closedUnmatchedIssues` selection logic exactly as-is on both surfaces (closed, not attached to any unit, sorted ascending).

## Out of scope

- Server/snapshot changes.
- Changing open-issue/hybrid/Orphaned behavior.
- Actions/dispatch/queue.

## Acceptance criteria

1. Closed-unmatched issues are always visible on the TUI board (no keybinding required) and the web board (no checkbox) — same set as before: closed issues not attached to any unit, sorted ascending.
2. No toggle artifacts remain: no `showClosed` state, no `i` keybinding, no checkbox/toolbar control, no "closed on/off" help text.
3. The section is hidden when there are no closed-unmatched issues (empty state unchanged).
4. Existing open-issue cards, hybrid units, and Orphaned behavior unchanged.
5. Tests updated to assert always-on behavior on both surfaces.
6. `npm run check` passes.

## Validation

Inside the worktree: `npm run typecheck`, `npm test` (updated TUI + web tests), `npm run build`, `npm run check`; render both surfaces with a fixture snapshot containing closed issues (linked + unlinked) and confirm the closed-unmatched set always appears, with no toggle present. Report actual outputs.

## Handoff

Builder reports: files changed (both surfaces), what was removed (toggle state/keybinding/checkbox/help), tests updated, before/after sample output, risks, remaining work, three-way reconciliation.
