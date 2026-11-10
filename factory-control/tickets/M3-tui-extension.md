# Draft Item

**Title:** M3: Add a Factory screen to the pi terminal for operating the board
**Type:** Ticket
**Parent:** Factory control center (M0–M4)
**Length:** 310 words

## Summary

A pi extension that adds a `/factory` screen inside the operator's existing pi
session: the unit board plus an action menu powered by the M2 action API. It
reuses Herdr's live status widget and pane focus rather than replacing them.

## User Story

As the factory Lead, I want the board and actions inside the terminal I already
use, so that I operate the factory without switching tools.

## Acceptance Criteria

1. Opening `/factory` renders the live board with stage columns and attention
   flags.
2. Selecting a unit shows spec, git, PR/checks, handoff trail, and suggested next
   action.
3. Actions appear only when their M2 preconditions pass; the confirm flow is
   explicit.
4. Rejected actions display the exact guard reasons (e.g. review/QA pending).
5. The Herdr agent widget and click-to-focus pane navigation still work untouched.
6. Keyboard-only operation works in regular terminal mode.
7. A control-server-off state shows a clear banner and retry (and can start the
   server).
8. `npm run check` passes for the extension package.

## Technical Notes

- **Location:** `factory-control/tui/` — a pi extension loaded by the pi config;
  built on `@earendil-works/pi-tui`.
- **Screen:** `ctx.ui.custom()` custom component: header (branch/dirty, snapshot
  age, attention counts); board view with `ScrollView` stage columns; detail view
  (Esc back); action menu derived from unit flags; agents panel.
- **Actions:** each action calls M2 `prepare` → show precondition plan →
  `ctx.ui.confirm()` → `execute`; result feedback inline; 409 reasons rendered.
- **Widget:** optional `ctx.ui.setWidget()` compact strip (working/blocked/
  settling/unknown/lost counts + snapshot age).
- **Data:** poll `GET /api/snapshot` ~5 s while open; never mutate the snapshot.
- **Integration with Herdr:** agent rows are read-only here; clicking defers to
  native Herdr pane focus. Do not re-render or duplicate the Herdr widget.
- **Input:** `matchesKey`/injected `KeybindingsManager`; every interaction has a
  keyboard path; mouse optional in fullscreen.

## Testing

- Unit: pure renderers (snapshot → lines) and action-menu derivation; keybinding
  handling.
- Manual smoke in pi TUI (fullscreen + regular mode): `/factory` opens; scroll;
  detail; run a non-mutating action (`checks/run`) in a fixture worktree through
  prepare→confirm→execute; confirm a guard-blocked action is rejected with
  reasons; keyboard-only works; agent-row click focuses a live pane.

## Item Links

- blocked by: M0-snapshot-core, M2-guarded-actions
