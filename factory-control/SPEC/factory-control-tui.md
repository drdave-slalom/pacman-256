# M3 spec: factory-control pi TUI extension

**Status:** Draft — not approved; do not implement until the Lead approves and a
ticket is assigned. · **Workstream:** pacman-256 factory control center (M3)
**Sources:** [brainstorm](factory-control-brainstorm.md),
[M0 snapshot spec](factory-control-snapshot.md),
[M2 actions spec](factory-control-actions.md), pi TUI docs
(`@earendil-works/pi-tui` components, `ctx.ui.custom()` / `ctx.ui.setWidget()`).

## Goal

A **pi extension** (`factory-control/tui/`) that adds a *Factory* screen and an
action menu to the operator's pi session. It is the only action surface (M2
server endpoints) and reuses Herdr's pane management: the live status widget
continues to own agent rows, and clicking an agent row focuses its pane (native
behavior). The extension renders the snapshot from the local M0 server.

## Out of scope

- Web mirror (M1) and triggers (M4) — not here.
- Replacing or duplicating the Herdr status widget; the extension augments, and
  never fights, Herdr pane management.

## Assumptions

- M0 server is running locally (extension shows a clear "control server off"
  state otherwise and can start it via `npm run factory:control`).
- The pi extension API provides the documented custom-screen lifecycle
  (`ctx.ui.custom()`, `render(width)`, `handleInput`, `done()`), built-in
  components (`Container`, `VStack`, `HStack`, `Box`, `SelectList`, `ScrollView`,
  `MouseRegion`, `Text`), keybindings (`matchesKey`/injected
  `KeybindingsManager`), and `ctx.ui.confirm()`/`select()` for confirms.
- Every interaction has a keyboard path (regular terminal mode), with fullscreen
  mouse as a convenience.

## Extension behavior

### Command and screen

- Registers a command `/factory` (and `/factory <query>` to filter units) that
  opens the custom Factory screen via `ctx.ui.custom()`.
- `ctx.ui.setWidget()` (optional) adds a compact status strip (working/blocked/
  settling/unknown/lost counts + snapshot age) so the factory state is visible
  without opening the screen.

### Factory screen layout (fullscreen custom component)

- **Header:** repo branch/dirty, snapshot age, attention counts.
- **Board view:** stage columns (`Spec → Dispatch → Execute → Review → QA →
  Integrate → CI → Done` + Unknown/Orphaned), cards per unit with badge glyphs.
  Scrollable (`ScrollView`); select a card with ↑/↓ + Enter or mouse.
- **Detail view:** the selected unit (spec, git, PR/checks, handoff trail, flags,
  suggested next action). Back with Esc.
- **Action menu:** derived from the unit's flags — e.g. “Create worktree”,
  “Run checks”, “Open PR”, “Watch CI”, “Merge”, “Remove worktree”. Each action
  calls the M2 server `prepare` → shows the precondition plan → operator confirms
  (`ctx.ui.confirm()`) → `execute`; result feedback inline. Rejected actions show
  the 409 reasons (e.g. “review/QA pending”).
- **Agents panel:** read-only rows from the snapshot (lifecycle, definition,
  task, elapsed, model, context %). Clicking an agent row does NOT reimplement
  focus — the extension asks Pi/Herdr to focus the matching live pane (native
  agent-row focus) and falls back to showing the unit detail when no live pane
  matches.

### Data

- Polls `GET /api/snapshot` ~5 s when the screen is open (and on `refresh`).
- Never mutates the snapshot; all writes go through M2 prepare/execute.

### Error handling

- Server unreachable → banner + retry; still allow opening the screen.
- Action failures → show the exact guard failure reasons from the API.
- Width handling via `truncateToWidth`/`visibleWidth` per pi TUI contract.

## Tests / validation

- Unit: pure renderers (snapshot → lines) and action-menu derivation from flags;
  keybinding handling for selecting cards.
- Manual smoke in pi TUI (fullscreen + regular mode): `/factory` opens; board
  scrolls; select card → detail; run a non-mutating action (`checks/run`) in a
  fixture worktree and confirm the prepare→confirm→execute flow returns output;
  confirm a guard-blocked action (e.g. merge without QA) is rejected with reasons;
  keyboard-only path works; clicking an agent row focuses a live pane when one
  exists.

## Acceptance criteria

1. `/factory` opens a Factory screen showing the live snapshot with stage columns
   and attention flags.
2. Detail view shows spec, git, PR/checks, and the handoff trail.
3. Actions are available only when their M2 preconditions pass; the confirm flow
   is explicit; outputs/rejections are shown.
4. The Herdr agent widget and pane focus remain intact — the extension never
   re-renders the herd as a competing control surface.
5. Keyboard-only operation works in regular terminal mode.
6. `npm run check` passes.

## Handoff

Builder reports: files changed (extension package, config wiring to load the pi
extension), screen/component structure, how snapshot polling and action calls are
implemented, manual smoke results (fullscreen + regular mode, action flows),
deviations, and the three-way reconciliation. Escalate before performing any
mutation outside the M2 prepare/execute protocol, re-rendering/duplicating the
Herdr widget, or changing pi extension wiring.
