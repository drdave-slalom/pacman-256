# Draft Item

**Title:** M1: Show the factory pipeline as a read-only team web board
**Type:** Ticket
**Parent:** Factory control center (M0–M4)
**Length:** 300 words

## Summary

A read-only web app (Vite/React) served by the control server that renders the
snapshot as a kanban of units, a detail page, and a live herd panel. Teammates
open it over the local network; no button mutates anything.

## User Story

As a teammate, I want to glance at what is running and blocked, so that the team
stays in sync on progress without pinging the lead.

## Acceptance Criteria

1. The board shows every unit in its inferred stage column with attention badges.
2. The detail page shows spec goal, git facts, PR/checks, and the handoff trail.
3. The herd panel mirrors live agent states and refreshes by polling.
4. All mutation methods on the web surface return 404/405; no UI element writes.
5. The app is reachable from another machine on LAN when `HOST=0.0.0.0`.
6. Default binds localhost; an unreachable control server shows a friendly state.
7. `npm run check` passes with the new workspace wired.

## Technical Notes

- **Location:** `factory-control/web/` — Vite + React + TypeScript; served as a
  static build by the factory-control server.
- **Sharing:** snapshot TypeScript types shared with the server (single module).
- **Pages:** `/` board (columns `Spec → Dispatch → Execute → Review → QA →
  Integrate → CI → Done` + Unknown/Orphaned; cards with stage, branch, agent
  chips, PR + check icon, diff ±N, attention badges); `/unit/:id` detail (spec,
  git, PR/checks, handoff trail, display-only suggested next action);
  `/agents` herd panel (lifecycle glyph, state, task, elapsed, model, context %).
- **Data:** fetch `GET /api/snapshot` every ~5 s; on fetch error render a
  "control server not reachable" state.
- **Env:** `HOST`/`PORT` (default `127.0.0.1:4173`). Document `HOST=0.0.0.0`
  as a trust decision in the README.
- **Read-only:** no auth headers; no write endpoints; mutations are 404/405.

## Testing

- Unit: pure selectors/reducers for stage→column mapping and attention badges.
- Integration: serve a fixture snapshot; assert `/`, `/unit/:id`, `/agents`
  render; assert POST/DELETE/PUT return 404/405.
- Manual: open from a second machine on LAN; board updates within ~10 s.

## Item Links

- blocked by: M0-snapshot-core
