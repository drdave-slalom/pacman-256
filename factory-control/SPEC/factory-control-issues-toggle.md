# Factory spec: "Show closed issues" toggle (TUI + web)

**Status:** Draft — for builder execution. · **Workstream:** factory control center (issue visibility follow-up; relates to #76–#79).
**Sources:** [M1 web spec](factory-control-web-mirror.md), [M3 TUI spec](factory-control-tui.md), user request.

## Problem

Closed GitHub issues (e.g. #53) never appear in the factory views. The snapshot already carries all issues (`snapshot.issues`, open + closed); open unmatched issues become cards, and issues linked to a unit render on that unit. Closed issues are otherwise invisible. Add a **toggle** on both surfaces (TUI board and web board) that surfaces closed issues.

## Goal

A user can toggle "show closed issues" on the factory board. When ON, a **Closed issues** section lists exactly the closed issues that are **not already represented by a unit card** (i.e. not attached to any unit via `unit.issue`), so nothing is duplicated. Default OFF. Same behavior on the TUI and the web mirror.

## Scope (in)

- Shared pure selection logic (duplicated per surface's own selectors is fine; keep them small and identical): `closedUnmatchedIssues(snapshot)` → `IssueCard[]` = `snapshot.issues.filter(i => i.state === "closed" && !linkedNumbers.has(i.number))`, where `linkedNumbers = new Set(snapshot.units.map(u => u.issue?.number).filter(n => n !== undefined))`. Sort by number ascending.
- **TUI** (`factory-control/tui/src/`):
  - `screen.ts`: `showClosed` boolean state (default false); a new keybinding toggles it (use `i` — `c` is taken by copyLeadPrompt); help/status hint reflects the toggle.
  - `render.ts`: new `renderClosedIssues(issues, style, width)` rendering a "Closed issues (N)" section after the Orphaned section: one dim row per issue `#N title [status]` (using `issueDisplayStatus`), truncated to width.
  - `keyroutes.ts`: add `toggleClosedIssues()` op and route `i`.
  - Tests: selectors (`closedUnmatchedIssues`), render (section appears when ON, absent when OFF; exact lines; empty section hidden), keyroutes (`i` toggles).
- **Web** (`factory-control/web/src/`):
  - `Board.tsx`: a checkbox toggle ("Show closed issues") in the board toolbar; when ON, append a `.column-issues` section after Orphaned rendering the same closed-unmatched list — each row `#N title` linked to `issue.url`, with the status label chip (reuse `issueStatusLabel`).
  - `state/selectors.ts`: `closedUnmatchedIssues(snapshot)`.
  - Tests: selectors; Board render test (toggle OFF → no section; ON → exactly the closed-unmatched issues render, linked).

Keep existing open-issue cards, hybrid units, and Orphaned behavior unchanged.

## Out of scope

- Server/snapshot changes (issues already ingested).
- Changing how open issues become cards.
- Actions/dispatch/queue changes.
- Making closed issues interactive on the TUI (they are read-only rows; web rows link to GitHub).

## Acceptance criteria

1. Default: both surfaces hide closed issues (no visible change).
2. ON: both surfaces show a "Closed issues" section containing exactly the closed issues not attached to any unit, sorted by number; no duplicates with existing cards.
3. OFF: section hidden again; toggling is instant (no reload needed beyond the normal re-render).
4. TUI: toggle via `i` (documented in the on-screen help/status); keyboard-only works.
5. Web: toggle via checkbox; rows link to the GitHub issue URL.
6. New tests cover: selection logic, render/section appearance + exact contents on both surfaces, empty-state (section hidden when none), toggle behavior.
7. `npm run check` passes (server + web + tui suites green).

## Validation

Inside the worktree: `npm run typecheck`, `npm test` (new tests for both surfaces), `npm run build`, `npm run check`; render both surfaces with a fixture snapshot containing open + closed issues (some linked, some not) and confirm the exact set shown. Report actual outputs.

## Handoff

Builder reports: files changed (both surfaces), shared selection logic, toggle wiring, tests added, before/after sample output (TUI lines + web DOM/section), risks, remaining work, three-way reconciliation.
