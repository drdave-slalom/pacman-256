# T6 spec: match HUD, spectating, and results

**Status:** Proposed for implementation (Lead) · **Lane:** A (client)
**Sources:** [delivery plan T6](../DELIVERY-PLAN.md), [game contract](../docs/GAME-CONTRACT.md)
(§1 state machine, §3 authoritative state, §7 visible failures), [decision log](../docs/DECISIONS.md)
(D039 replay flow, D044, D049, D053), [T5 spec](../SPEC/T5-countdown-contact-round-end.md).

**Base:** stacked on `factory/t5` (PR #26, open). T6 consumes T5's server state:
countdown phase, `countdownEndsAt`/`roundEndsAt`, elimination via `players[].alive`,
`resultWinner`/`resultReason`/`resultEndedAt`, and host `returnToLobby`.

## Goal

The client renders a complete match experience on top of T5's authoritative state:
a match HUD (phase, round/countdown time, alive players), a spectator mode when the
local player is eliminated, and a results view that shows exactly what the server
declared. The UI must **never** guess the winner or any round outcome.

## Owner choices (2026-11-10)

- **Hybrid rendering:** HTML panels for structured HUD/spectator/results content
  (styled like the existing lobby UI, accessible, patch-rate safe), plus a light
  Phaser overlay for the countdown numeral so it is legible on the maze.
- **View routing:** `lobby` → join/lobby panel; `countdown`/`playing`/`results`
  → game view (maze + players remain visible). This replaces the T5 behavior where
  every non-playing phase shows the lobby panel.
- **Maze rendering phases:** the maze and spawned players render during countdown,
  playing, and results (round started). Steering is only valid during `playing`
  for alive players.
- **Results placement:** a results overlay in the game view shows the server result
  line and, for the host, the **Back to lobby** control (moved from the lobby
  panel). Lobby panel shows only the `lobby` phase.

## Implementation plan

**Client pure model (`apps/client/src/session-model.ts` / new `hud-view.ts`):**
- `isMazePhase(snapshot)`: phase in countdown/playing/results and `roundId !== ""`.
- `formatClock(ms)`: `m:ss` display formatting (pure).
- `countdownRemaining(snapshot)`: seconds from `countdownEndsAt`/`serverTime`, clamped ≥ 0.
- `roundTimeRemaining(snapshot)`: ms from `roundEndsAt`/`serverTime`, clamped ≥ 0 (display-only).
- `aliveCounts(snapshot)`: `{hunter, runner}` from server `players` (alive + team; ignore unassigned).
- `canSteer(snapshot, localId)`: phase === playing && local player alive && roundId set.
- `isLocalEliminated(snapshot, localId)`.
- Keep `resultSummary` semantics; add `resultView(snapshot)` returning structured/null result info
  used by the overlay. Winner/reason text only ever derived from `resultWinner`/`resultReason`
  when phase === results; otherwise `null`.

**Scene (`apps/client/src/maze-scene.ts`):**
- Use `isMazePhase`/`mazeKey` so countdown/results render maze+players.
- Countdown numeral overlay (Phaser text) driven by `source.snapshot()`; hidden outside countdown.
- Dim eliminated mascots (e.g., lower alpha); local eliminated player gets no local ring and no steering.

**HTML/CSS/wiring (`apps/client/index.html`, `style.css`, `main.ts`):**
- HUD bar in the game panel: phase chip, timer, alive counters, local status.
- Spectator overlay shown when local player is eliminated during play; D-pad visually disabled.
- Results overlay in the game panel: server result line + host **Back to lobby** button
  (reuse `#return-lobby` id; requests `returnToLobby {requestId}` via the existing action path).
- `render()` routes by phase; only touch DOM when the derived strings change (patch-rate safe, aria-live).
- `sendDirection` continues to gate on `canSteer`.

## Acceptance criteria

1. **Countdown:** after host start, the game view shows a 3→… countdown derived only from
   `countdownEndsAt`/`serverTime`; maze and spawned players are visible; no movement input is accepted.
2. **Playing HUD:** round time remaining (`roundEndsAt` − `serverTime`, `m:ss`, clamp ≥ 0),
   alive hunter/runner counts from server `players`, and phase chip "Playing".
3. **Spectating:** when the local player is eliminated during play, a spectator overlay appears,
   steering controls are disabled, the local mascot is dimmed, and other players keep rendering.
4. **Results:** on phase `results`, the results overlay shows exactly the server-declared
   `resultWinner`/`resultReason` text; the host sees **Back to lobby**, others see a waiting message.
   No winner/outcome text is ever derived locally (negative test required).
5. **Return to lobby:** host click sends `returnToLobby`; on accept the room returns to `lobby`
   (result fields cleared, teams retained) and the UI returns to the lobby panel; rejected attempts
   surface an actionable message (`HOST_REQUIRED`/`INVALID_PHASE`).
6. **Regression:** create/join/team pick/start and synchronized movement unchanged; eliminated
   players cannot steer (server enforces; client drops); `npm run check` passes in the worktree.
7. **Tests:** pure HUD view functions have unit tests; an integration test drives the real T5 room
   with an injected fast clock through countdown → playing → elimination/timeout → results and asserts
   the derived UI strings; include the no-winner-guessing negative case.

## Validation

- `npm run check` inside `WORKTREE=/home/chase/pacman-256-wt-t6` (typecheck, tests, builds).
- New unit tests in `apps/client/src/*.test.ts` run by the root `npm test`.
- Integration-style test uses the server room harness (`gameRoomWith` clock injection) to produce
  snapshots across phases; assert model strings.
- Local dev smoke: `npm run dev`, two browser tabs (or two SDK clients) join, observe countdown →
  playing HUD; result view verified via the fast-clock integration test (live timeout is 180 s).

## Out of scope

Pickups and conditional vulnerability (T7); visual polish beyond the HUD/spectator/results core
(T9); physical-phone matrix and performance measurement (T8/T9); changing server rules or the
contract (T5 owns those; coordinate via David if a gap appears).
