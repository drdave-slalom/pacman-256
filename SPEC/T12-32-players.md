# T12 — Support up to 32 players (scalable rooms, mazes, spawns)

Issue: https://github.com/drdave-slalom/pacman-256/issues/83
Owner: factory Lead (this session). Baseline: `main` at e1a9872. Dependencies: T5/T6/T7 implemented; nothing blocking.

## Goal and scope
Raise the private-room player cap from **4 to 32** while keeping the approved 4-player MVP behavior intact. This covers, in one integrated unit:

- The room capacity constant and the join-failure contract (`ROOM_FULL`).
- A spawn system that scales to **16 per team (32 total)** distinct, deterministic cells.
- A maze generator whose dimensions scale with player count for rooms above MVP size, preserving the current 21×19 path (and its games) for small rooms.
- Server simulation correctness/performance at 16v16, client HUD/spectator handling of 32 players, and updated/new tests.
- Validation: `npm run check` green, a local high-count match over the network, and a cloud deploy smoke test.

No new mechanics, new protocol messages, matchmaking service, art/audio, or change to the four-player game feel beyond the capacity change. Out of scope: playtesting and balancing the *game feel* of 32-player matches (that is a follow-up, not manufactured here).

## Current state (facts the change must respect)
- `GAME_RULES.maxPlayers = 4` in `packages/shared/src/index.ts`; `GameRoom.maxClients = GAME_RULES.maxPlayers` (`apps/server/src/game-room.ts`).
- `ROOM_FULL: "That room is full (4 players). Ask the host for another room."` — `packages/shared/src/protocol.ts`.
- Spawns are hardcoded to **3 per team**: `SpawnCells` is a fixed `readonly [SpawnCell, SpawnCell, SpawnCell]` tuple per team (`packages/shared/src/spawn.ts`); `game-room.ts` asserts a cell exists when placing each player, so a 4th player on a team crashes the server.
- Maze is fixed **21×19** (`packages/shared/src/maze-gen.ts`), generated deterministically from a uint32 seed; client and server regenerate identical maps from the shared seed.
- Contact resolution is O(hunters × runners) per tick (`sweptContact`); team sizes may be uneven (D054), but starting requires ≥1 hunter and ≥1 runner and every player assigned.
- Client HUD/spectator render from the authoritative player map (generic); no hardcoded 4-player roster found, but a 32-player roster needs layout verification on mobile.

## Design constraints (the builder implements these; record choices as shared constants where tunable)

### Capacity
- Set `GAME_RULES.maxPlayers = 32` (single source of truth). Keep `GameRoom.maxClients` derived from it.
- Update the `ROOM_FULL` message to reflect the new cap (e.g., "…is full (32 players)…") and any client-visible copies.
- Preserve phase behavior: joins only in lobby, `JOIN_CLOSED` after start, host/room rules unchanged, room stays private.

### Spawns (scale to 16 per team)
- Generalize spawn placement to `N` cells per team for `N ≤ 16`, deterministic per maze/seed and join order.
- Hunters spawn in the top half of the maze, runners in the bottom half; cells must be walkable, distinct, and spread across the team's half (prefer wall-adjacent cells so `spawnDirection` can face a wall, as today).
- Guarantee the per-team spawn count ≥ the largest team that can join (the capacity cap), so the server never indexes past the available cells; replace the crash assert with construction that cannot exceed, plus a test.
- Keep `spawnDirection` behavior and the deterministic API used by `game-room.ts`.

### Maze scaling
- For rooms where each team ≤ 4 (total ≤ 8): keep the existing 21×19 generation path **byte-for-byte** so all current maze tests remain green.
- For larger rooms: parameterize the generator by dimensions derived from room size (put the sizing rule in shared config so server and client agree). The generated maze must preserve every existing invariant: full border walls, one-tile corridors, full connectivity, symmetry (mirror pairs + center axis), loop richness, and no 2×2 solid blocks, deterministically per seed. Interior area must comfortably support the required spawn count and expected player density.
- Client and server must keep regenerating identical maps from the same seed.

### Simulation performance
- Verify the 30 Hz tick stays well under its 33 ms budget at 32 players (16v16). O(H×R) contact checks are expected to be fine; if not, add spatial partitioning around contact checks only. No algorithmic regression for small rooms.
- Client input rate-limiting, message validation, and authoritative-state rules are unchanged.

### Client
- The HUD roster must render up to 32 players from the authoritative map: per-team counts correct, alive/eliminated/spectating statuses intact, roster scrollable/compact on mobile, touch controls and existing layout preserved. No client gameplay authority.

## Acceptance criteria
1. A private room admits up to 32 players; the 33rd join fails with `ROOM_FULL` (updated message). Joins still require the lobby phase.
2. A match starts with up to 16 hunters and 16 runners; every player receives a distinct, deterministic, walkable spawn cell; uneven teams up to capacity start cleanly; a side with zero players still cannot start.
3. Maze generation at large room sizes preserves all invariants across multiple seeds; the 21×19 path is unchanged for small rooms (existing tests pass unchanged).
4. The simulation completes full 16v16 rounds correctly: contact eliminations, pickups, timeout, simultaneous wipes, and disconnects behave per the contract at scale.
5. Server tick budget holds at 32 players (measured, reported).
6. Client HUD/spectator handles 32 players without layout breakage; per-team counts and statuses correct.
7. `npm run check` green, including new coverage: capacity (32nd joins, 33rd fails), spawn-at-scale (16v16 distinct/deterministic, uneven teams), maze invariants at scale, 16v16 contact correctness, and client roster at 32.
8. A local high-count match (simulated clients, or real devices) is verified over the network; a cloud deploy smoke test (deploy, connect N synthetic clients, confirm sync/latency) is executed and reported.

## Validation and handoff
Run the README commands inside the worktree only: `npm run typecheck`, `npm test`, `npm run build` (`npm run check` combines them), plus the focused suites above. Report exact commands and observed output, changed paths, architectural choices, tuning constants introduced, limitations, and what remains for human phone/LAN or deploy smoke verification. Independent `pr-reviewer` and `qa-tester` must pass before any PR. Do not fabricate physical-device or deploy evidence; if a required cloud credential or device is unavailable, stop and report to the Lead.

Escalate only contract conflicts, unavailable tooling/deployment access, unsafe dependencies, or required scope expansion. Do not create/merge a PR or change remote issues; the Lead owns those actions.
