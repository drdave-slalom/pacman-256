# T3 spec: private rooms and synchronized movement

**Status:** Approved for implementation by David (2026-11-10) · **Lane:** B
**Sources:** [delivery plan T3](../DELIVERY-PLAN.md), [game contract](../docs/GAME-CONTRACT.md),
[decision log](../docs/DECISIONS.md) (D021-D024, D039-D040, D044, D047).

## Goal

Two to four clients create or join one private room by code, pick balanced teams,
and the host starts. Every client then sees every player move. Movement is
server-authoritative, in a maze generated from a server-chosen seed. Invalid, full,
or closed room joins and rejected actions are shown to the player. The server
rejects malformed or out-of-phase input.

## Owner choices (2026-11-10)

- The start flow follows the contract: `chooseTeam` + host `startMatch` (balanced 1v1/2v2)
  goes **directly to `playing`**. T5 adds the 3-second countdown, contact, and round end.
- The client gets a minimal working UI; T4 polishes the mobile lobby and LAN docs.

## Assumptions (record as implementation context, not new rules)

- The join code is the opaque Colyseus `roomId` (contract §2 allows this initially).
- The server picks a uint32 maze seed per round and syncs it. Clients regenerate the
  maze with `generateMaze(seed)` (D047). Clients never choose the seed.
- Opponent blocking, contact, elimination, round end, `returnToLobby`, and countdown
  are **out of scope** (T5/T6). In T3 all players pass through each other and a round
  continues until players leave.
- 30 Hz fixed-step simulation (dt = 1/30 s), ~20 Hz patches (contract §3 tuning).
- The input rate limit is a tunable starting value that still needs review (contract §2).

## Implementation deviations (accepted after review, 2026-11-10)

- **No `lock()` on start.** Colyseus reports a locked room and a full room with the
  same "is locked" error, so the client could not tell `JOIN_CLOSED` from `ROOM_FULL`.
  The room instead rejects non-lobby joins in `onAuth`/`onJoin` with `JOIN_CLOSED`.
  A started four-player room still reports `ROOM_FULL`. Do not add `lock()` later
  without keeping these codes distinguishable.
- **Malformed `chooseTeam`/`startMatch`.** When a valid `requestId` can be read, the
  reply is a correlated `actionResult` with `INVALID_INPUT`. Otherwise the reply is
  `inputRejected`. Clients must handle both and never leave a request pending.
- **No idle patch suppression.** `revision`/`serverTime` advance on every tick in all
  phases, so lobbies also patch at ~20 Hz.

## Out of scope

Countdown, contact/elimination, pickups, timers/deadlines, results, `returnToLobby`,
reconnect, polished mobile lobby (T4), client prediction, cloud/CI changes.

## Shared protocol (`packages/shared`)

Add a protocol module re-exported from `index.ts`:

- `GAME_ROOM = "game"`; `SIMULATION_HZ = 30`; `PATCH_INTERVAL_MS = 50`;
  `MAX_DISPLAY_NAME_LENGTH = 16`; input rate-limit constants.
- `ErrorCode` union of the contract §7 codes.
- Client → server messages: `chooseTeam {requestId, team}`, `startMatch {requestId}`,
  `setDirection {roundId, sequence, direction}`.
- Server → client: `actionResult {requestId, accepted, code?, message?}` for every
  `chooseTeam`/`startMatch`; `inputRejected {code, message}` for malformed/unknown
  messages and rejected movement (not for duplicate/old sequences).
- Pure runtime validators that return the parsed value or `null`:
  - join options: `protocolVersion`, and `displayName` trimmed to 1-16 characters
    with no control characters;
  - each message payload: `requestId` is a non-empty string ≤ 64 characters,
    `sequence` is a safe non-negative integer, and enums are checked;
  - non-objects and wrong types are rejected.
- `findSpawnCells(maze)` returns distinct walkable spawn cells, deterministic per
  maze. Hunters spawn near the top-left/top-right, runners near the
  bottom-left/bottom-right. Spawn separation is tunable.
- `joinErrorCode(error)` maps a join failure to an `ErrorCode`, from either the server
  message prefix or the Colyseus room-not-found/locked errors. Also provide a
  player-facing message for each code.

## Server (`apps/server`)

Register a new private room as `GAME_ROOM`. Creating and joining both take
`{protocolVersion, displayName}`; joining uses `joinById(code, ...)`. Private rooms
are not listed for matchmaking.

| Check | Failure code |
|---|---|
| protocol version mismatch / missing | `PROTOCOL_MISMATCH` |
| invalid display name/options | `INVALID_INPUT` |
| unknown room code | `ROOM_NOT_FOUND` |
| 4 participants already | `ROOM_FULL` |
| phase is not `lobby` | `JOIN_CLOSED` |

A join failure must reach the SDK caller as an error that `joinErrorCode` maps to
the right code. Verify real Colyseus behavior, and map its built-in errors if needed.

**State:**

- Room fields: `protocolVersion`, `roomCode`, `hostPlayerId`, `phase`, `revision`
  (increments on every state change and tick), `serverTime` (ms), `roundId`, `mazeSeed`.
- `players` map entries: `id`, `displayName`, `team` (`unassigned|hunter|runner`),
  `alive`, `x`, `y` (fractional tiles), `direction`, `queuedDirection`,
  `lastInputSequence`.
- Player identity is the server session ID; clients never supply it.

**Messages:**

- `chooseTeam`: lobby only (`INVALID_PHASE`); max 2 per team (`TEAM_FULL`); re-choosing
  the same team is accepted.
- `startMatch`: host only (`HOST_REQUIRED`); lobby only (`INVALID_PHASE`). Every player
  must have a team, with hunters = runners ≥ 1 (`TEAMS_UNBALANCED`). On accept: set a
  new unique `roundId` and a new `mazeSeed`, spawn players via `findSpawnCells`, set
  phase `playing`, and lock the room. Tests must be able to inject the seed source;
  clients must not be able to set it.
- `setDirection`:
  - invalid payload → `INVALID_INPUT`;
  - phase is not `playing` → `INVALID_PHASE`;
  - wrong `roundId` → `STALE_ROUND`;
  - `sequence ≤ lastInputSequence` → silently discarded;
  - over the rate limit → `RATE_LIMITED`, input dropped;
  - otherwise set `queuedDirection` and `lastInputSequence`.
- Unknown message type → `inputRejected INVALID_INPUT`.

**Simulation:** on each tick in `playing`, advance every alive player with shared
`stepPlayerMove(state, DEFAULT_MOVE_SPEED_TILES_PER_SECOND, 1/30, maze)`. Write back
position, direction, and queued direction. Clients never send positions or speed.

**Leave/disconnect:** remove the player and transfer host to the earliest-joined
remaining player. Colyseus disposes the empty room. Empty-side outcomes are T5.

## Client (`apps/client`)

- Join panel: display-name input, **Create room**, room-code input + **Join**.
- Lobby panel: room code (copyable), player list with team and host marker,
  **Hunters**/**Runners** buttons, **Start** (host only), visible error text.
- Game:
  - Render the maze from the server's seed.
  - Draw every player as a team-colored circle, with the local player visibly
    distinct, interpolated between patches.
  - The D-pad, swipe, and keyboard send `setDirection` with the current `roundId`
    and an increasing sequence.
  - No local movement authority and no prediction.
- Every join or action failure and every unexpected disconnect shows an actionable
  message (contract §7) and returns to a usable state. Never silently report success.
- Keep the existing touch/anti-scroll behavior and the T1 connection check.

## Acceptance criteria

1. Two SDK clients: A creates, B joins by code; both see two players in state.
2. Unknown code → `ROOM_NOT_FOUND`; fifth client → `ROOM_FULL`; join after start →
   `JOIN_CLOSED`; bad version → `PROTOCOL_MISMATCH`; bad name → `INVALID_INPUT`.
3. `chooseTeam`: a third pick of the same team → `TEAM_FULL`; any pick after start →
   `INVALID_PHASE`. Every request gets a correlated `actionResult`.
4. `startMatch`: non-host → `HOST_REQUIRED`; unbalanced/unassigned → `TEAMS_UNBALANCED`;
   balanced 1v1 and 2v2 accepted → `playing` with `roundId`, `mazeSeed`, distinct spawns.
5. After A sends `setDirection`, B observes A's position change. Positions stay on
   walkable cells of `generateMaze(mazeSeed)`.
6. Malformed or spoofed payloads (extra position fields, bad enums, negative/float
   sequences, non-object) → `INVALID_INPUT` and no state change. Stale round →
   `STALE_ROUND`; a repeated sequence is ignored; lobby input → `INVALID_PHASE`.
7. Host leaves → host transfers; all leave → room disposed.
8. Client builds. A manual two-tab smoke test shows create/join/team/start and
   mutual movement, plus a visible error for a bad code.
9. `npm run check` passes.

## Validation

- `npm run check`.
- Real Colyseus SDK integration tests in `apps/server/src/*.test.ts`.
- Shared validator unit tests.
- Manual two-browser smoke test via `npm run dev`.

Physical two-phone LAN validation belongs to the T4/Day-1 exit gate.
