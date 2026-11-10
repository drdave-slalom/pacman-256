# Unbalanced lobbies (no even team requirement)

**Status:** Proposed · **Date:** 2026-11-10
**Supersedes:** the balanced-start and 2-per-team-cap portion of D049 / the
T3 contract section 1 "capped at two per team" and "balanced 1v1 or 2v2" rules.
**Owner (implementation):** delegated builder · **Reviewer:** pr-reviewer /
QA: qa-tester.

## Problem

T3 requires equal hunter/runner counts (1v1 or 2v2) to start and caps each team
at two. The team wants no even-team requirement: players may pick any team
(team size is limited only by the room's 4-player cap), the host may start with
any roster that has **at least one player on each team**, and an unbalanced lobby
is a **warning only** (not a block). The lobby must show a live
Hunters-vs-Runners counter and alert players when the lobby is unbalanced.

## Decisions (confirmed with the team)

1. **No per-team cap.** Remove the `MAX_TEAM_SIZE = 2` restriction. A team may
   hold any number of players up to the room cap (4 total). Example: 3v1 is a
   valid start.
2. **Minimum roster:** at least one hunter and one runner must be assigned to
   start. A roster with an empty side is rejected.
3. **Unbalanced is a warning, not an error.** The server lets the host start an
   unbalanced lobby (e.g. 3v1, 2v1). The client shows a live counter and a
   "lobby unbalanced" warning; it does not disable Start.

## Behavior spec

### Shared (`packages/shared`)

- Remove `MAX_TEAM_SIZE` (or keep the constant only if the contract still needs
  it; otherwise delete and update all references/imports).
- `findSpawnCells` must produce **up to 3 spawn cells per team** so a 3-player
  team can spawn (v 3v1). Update `SpawnCells`/`findSpawnCells` to return 3
  hunter + 3 runner cells (or a parameterized count ≥ the largest possible team,
  which is 3 given a 4-player room and ≥1 on the opposing side). Keep the
  deterministic corner-based search; extend it to a third cell per team and add
  tests for 3-cell spawns (distinct, walkable, in quadrant).
- Keep the error code `TEAMS_UNBALANCED` in `ERROR_CODES` (still a contract
  visible code), but it is no longer emitted by the server as a rejection; the
  client uses count-based warnings. Update its `ERROR_MESSAGES` copy to be
  informative ("Teams are unbalanced" style) rather than "must be balanced".

### Server (`apps/server/src/game-room.ts`)

- `chooseTeam`: remove the `MAX_TEAM_SIZE` cap check. Any team is allowed while
  the phase is `lobby`. (`TEAM_FULL` becomes unused for the team-cap case; keep
  the code constant but stop emitting it, or leave the check only if the room
  cap is hit — clarify in implementation.)
- `startMatch` validation becomes:
  - host required (unchanged),
  - phase lobby (unchanged),
  - `hunters >= 1 && runners >= 1`; otherwise respond `INVALID_INPUT` (or a
    dedicated "needs one per team" message) — **no equal-count requirement**.
- Spawn assignment: assign spawns by team using the expanded spawn arrays;
  a 3-player team uses its third cell. Keep the deterministic join order.
- Update server tests: 3v1 starts; 2v1 starts; 2v0 / 1v0 rejected; team pick
  allows third hunter; unbalanced lobby no longer rejected.

### Client (`apps/client/src/main.ts`, lobby panel)

- Show a live counter in the lobby: `Hunters: X · Runners: Y` (derived from
  the player snapshot; ignore `unassigned` until they pick).
- When `X !== Y` (and at least one on each side), show a visible warning, e.g.
  "Lobby unbalanced: Hunters X : Runners Y. A team can win with fewer players;
  you can still start." The Start button remains enabled for the host.
- Update the lobby hint copy to drop "balanced (1v1 or 2v2)" wording.

### Docs

- Update `docs/GAME-CONTRACT.md` section 1 (team size/balance) and section 8
  acceptance scenario 1 to reflect the new rule.
- Record a new decision (D054) in `docs/DECISIONS.md` superseding the relevant
  part of D049.
- Note the rule change in the delivery plan T3/T5 context where balance is
  referenced.

## Acceptance criteria

- `npm run check` passes.
- Server tests cover: 3v1 start succeeds, 2v1 start succeeds, empty side
  rejected, team pick beyond 2 allowed.
- Shared spawn tests cover 3 distinct spawn cells per team.
- Client shows the counter and unbalanced warning while allowing host start.
- `TEAMS_UNBALANCED` no longer blocks start.
