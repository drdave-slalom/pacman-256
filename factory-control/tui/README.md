# factory-control TUI (M3)

A **pi extension** that adds a `/factory` command to the operator's pi session.
It opens a custom Factory screen (`ctx.ui.custom()`) showing the live M0
snapshot — board with stage columns, unit detail, action menu (M2 guarded
actions), and a read-only agents panel — without replacing or duplicating the
Herdr widget.

## Prerequisites

- The factory-control server (M0 snapshot + M2 action API) must be running:
  `npm run factory:control:serve` in the repo root (default
  `http://127.0.0.1:4780`).
- pi (>= 1.5.2) with the project trusted.

## Loading the extension

1. Install workspaces: `npm ci` at the repo root (registers the
   `@maze/factory-control-tui` workspace).
2. pi auto-discovers **`.pi/extensions/factory-control.ts`** after the project
   is trusted (see pi's extensions docs). It re-exports the extension package's
   default factory.
3. Untrusted projects or non-repo contexts: load the package directly with
   `pi -e <repo>/factory-control/tui/src/index.ts`, or add the path to
   `settings.json` `extensions`.

Verify: run `pi`, then `/factory` — the Factory screen should open. In
non-interactive output you can confirm the command registered via
`pi get_commands` / RPC `get_commands` (look for `factory`).

## Usage

| Key | Action |
| --- | --- |
| `↑`/`↓`, `PageUp`/`PageDown` | move selection / scroll board |
| `Enter` | open unit detail; open/focus a selected agent; open an action; confirm & execute in action detail |
| `Esc` | back one view (board → close) |
| `a` | agents panel (read-only rows) |
| `x` | action menu for the selected unit (detail view) |
| `r` | refresh snapshot now |
| `s` | (offline banner) request the server be started |

- `ctx.ui.setWidget("factory", …)` shows a compact strip (working/blocked/
  settling/unknown/lost counts + snapshot age) while the screen is open.
- The snapshot is polled every ~5 s while the screen is open.
- Actions: the menu is derived from unit flags; each row is validated through
  the M2 `prepare` endpoint. Passing rows are runnable (`prepare` → plan shown
  → `ctx.ui.confirm()` → `execute`); rejected rows show the exact guard
  reasons (409).
- Agents rows are read-only. Selecting one falls back to the owning unit's
  detail — native Herdr pane focus is intentionally untouched (no public
  affordance to reimplement it).

## Environment

- `FACTORY_CONTROL_URL` — server base URL (default `http://127.0.0.1:4780`).
- `FACTORY_CONTROL_TOKEN` — sends `X-Control-Token` for remote action sessions.

## Development

```
npm --workspace factory-control/tui run typecheck
npm --workspace factory-control/tui test
npm --workspace factory-control/tui run build
```

Pure logic lives in `src/selectors.ts`, `src/actions.ts`, `src/render.ts`,
`src/keyroutes.ts`, and `src/width.ts` (no pi runtime imports, unit-tested
against fixtures). The interactive component is `src/screen.ts`; the extension
entry is `src/index.ts`.
