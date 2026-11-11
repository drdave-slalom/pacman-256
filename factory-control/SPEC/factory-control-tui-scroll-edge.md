# Factory spec: TUI board — keyboard scrolling into trailing sections (Orphaned / Closed issues)

**Status:** Draft — for builder execution. · **Workstream:** factory control center (M3 TUI).
**Sources:** user report (scrolling to the end only shows the Done column), [M3 TUI spec](factory-control-tui.md), [always-on closed issues](factory-control-issues-toggle.md).

## Problem

The board's scroll position is coupled to the selected unit row (`ensureVisibleRow` → `boardRowOf`, which maps only stage columns and their units). Once selection reaches the last unit (the `Done` column), pressing Down/PageDown no longer scrolls, so the trailing sections appended after the columns — `Orphaned` and `Closed issues` — are unreachable via the keyboard. (Mouse wheel already scrolls; the keyboard path does not.) The user cannot see the always-on Closed issues section.

## Goal

Keyboard users can scroll the board viewport all the way to the true bottom (through `Orphaned` and `Closed issues`) and back, without changing selection semantics: units remain the only selectable/openable rows; the appended sections are informational and non-selectable.

## Scope (in)

- `factory-control/tui/src/screen.ts`:
  - Track the rendered body length (`lastBodyLen`) at render time (the `body.length` already known where `renderBody` returns).
  - In `moveSelection(delta)` (and thus `pageSelection`): when the next selection index would be clamped at the first/last unit edge, **scroll the viewport** in that direction instead of doing nothing — e.g. `scrollViewBy(sign * (lastRegion - 2))` for a page-ish step on page keys, and a smaller step (or the same) for arrow keys — clamped to `[0, max(0, lastBodyLen - lastRegion)]`.
  - Add a small private `scrollViewBy(rows)` using the existing `ScrollView` (`scrollTo(clamp(scrollTop + rows, 0, max))`).
  - Keep `ensureVisibleRow` behavior when selection actually moves (unchanged).
- Help text: no change required (scrolling is implicit), but ensure the help line remains accurate.
- Tests (`screen.test.ts` and/or `screen.issues.test.ts`): with a fixture board whose units are few enough that the appended sections are initially below the fold:
  - moving selection to the last unit then pressing Down once scrolls the viewport down (visible lines shift; `Orphaned`/`Closed issues` lines appear in the rendered output);
  - repeated Down/PageDown reach the true bottom (the `Closed issues (N)` rows are visible) and further presses clamp (no error, same output);
  - Up/PageUp from the bottom scroll back and restore selection/visibility;
  - selection/open logic unchanged (sections still not selectable; Enter on them no-ops);
  - mouse-wheel path still works (no regression).

## Out of scope

- Changing selection/row-map semantics or making sections selectable.
- Web mirror (scroll already fine there), server, actions, dispatch.
- Adding mouse-specific behavior (wheel already works).

## Acceptance criteria

1. With selection on the last unit, pressing Down (and PageDown) scrolls the viewport deeper when room exists — `Orphaned` and `Closed issues` become visible.
2. Repeated presses reach the true bottom; further presses are clamped (no crash, no infinite scroll).
3. Pressing Up/PageUp from the bottom scrolls back toward the top and selection visibility is restored.
4. Units remain the only selectable/openable rows; sections are informational (Enter/click no-op).
5. Mouse-wheel scrolling behavior is unchanged.
6. New tests cover edge scrolling (Down/PageDown), clamping at both ends, and that the Closed issues section is reachable; `npm run check` passes.

## Validation

Inside the worktree: `npm run typecheck`, `npm test` (new screen tests), `npm run build`, `npm run check`; drive the pure screen render/input with a fixture board and print the visible lines at the boundary states. Report actual outputs.

## Handoff

Builder reports: files changed, scroll-edge implementation, tests added, before/after visible-line samples at the edge/bottom/top, risks, remaining work, three-way reconciliation.
