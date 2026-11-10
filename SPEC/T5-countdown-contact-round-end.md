# T5 spec: countdown, baseline contact elimination, and team round end

**Status:** Implemented on Lead assumptions; pending David's approval at PR review
(he was unavailable when work started) · **Lane:** B (server/shared)
**Sources:** [delivery plan T5](../DELIVERY-PLAN.md), [game contract](../docs/GAME-CONTRACT.md)
§1, §3, §4, §5, §7, §8, [decision log](../docs/DECISIONS.md) (D040-D044, D047, D049),
[T3 spec](./T3-private-rooms-and-synchronized-movement.md).

## Goal

The authoritative server runs a complete round: host start → 3 s countdown →
playing → contact eliminations → a decided result (team win, draw, timeout, or
abandon) → host returns the room to the lobby. Eliminated players cannot act.
Disconnect outcomes are defined. No pickups or vulnerability yet (T7).

## Assumptions (state, do not treat as new rules)

- **Baseline contact (T5 only):** any contact between an alive hunter and an alive
  runner eliminates the runner (contract §5, row 1 with no vulnerability and no
  shields). Same-team contact never blocks or eliminates. Opponent *blocking* only
  exists in the shielded-runner case, so it arrives with T7.
- **Contact test:** a hunter and runner are in contact when the distance between
  their positions is ≤ `CONTACT_DISTANCE_TILES` (tunable constant in shared config,
  starting value 0.6). Detection is **swept**: test each pair over the segment each
  moved this tick (closest approach of the two relative paths), so a fast crossing
  or head-on swap between ticks cannot evade contact (contract §4).
- **Deadlines use server simulation time**, not wall-clock arithmetic scattered in
  handlers. The room uses an injectable clock (tests control it); effects/phases
  are active while `now < end`, expired at equality (contract §3).
- **Countdown** starts on an accepted `startMatch`. The roundId, maze seed, and
  spawns are assigned at countdown start so clients can render the maze. Players
  are frozen at spawn; `setDirection` during countdown → `INVALID_PHASE`
  (contract §2: play only).
- Joins during countdown/results stay `JOIN_CLOSED` (existing T3 behavior; no
  `lock()`, see T3 deviations).
- Client work is **out of scope** beyond keeping the T3/T4 client from crashing on
  the new phases/fields. The HUD, spectating view, and results screen are T6.
- Per-tick event order follows D041: expire effects (none yet) → move → pickups
  (none yet) → contacts from one snapshot → apply eliminations together → team
  victory → timeout.

## Implementation notes and deviations (after review, 2026-11-10)

- `PROTOCOL_VERSION` stays 1: the new snapshot fields are additive and the T3/T4
  client ignores them.
- **Deadline clamp:** wall-clock based (`#lastTickAt` capped at `roundEndsAt`), not an
  accumulated simulation clock. No movement or contact runs past the deadline.
- **Round outcome:** "alive before" counts are taken at the start of each playing step,
  after disconnects are applied. Both sides empty at step start → `abandoned`; both
  emptied during the step → `simultaneousWipe`.
- **Test hooks:** `gameRoomWith({ seedSource, clock, spawnPlacer })` is reachable only from
  trusted server code (`createGameServer` options), never from client join options.
- **Client:** eliminated players stop sending `setDirection`. No other UI changes.
- **Deferred to T6:** the client has no `returnToLobby` control yet. In `results` the host
  sees the lobby view, and Start is rejected with `INVALID_PHASE`.
- **Unit-level only:**
  - The deadline-step contact, `simultaneousWipe`, and `abandoned` are covered only by
    unit tests.
  - Under baseline T5 rules a contact wipe can't happen inside a room; it becomes
    reachable with T7 vulnerability.
  - The room-level all-leave test accepts any decided outcome, because three leaves
    don't reliably land in one tick.

## Out of scope

Pickups and effects, shield/vulnerability contact rows, opponent blocking, T6 HUD /
spectator / results UI, T4 lobby UI, reconnect, client prediction, cloud/CI changes.

## Shared (`packages/shared`)

- Constants: `CONTACT_DISTANCE_TILES`; reuse `GAME_RULES.countdownMs` (3 000) and
  `GAME_RULES.roundDurationMs` (180 000).
- `ReturnToLobbyMessage {requestId}` + `CLIENT_MESSAGES.returnToLobby` with a runtime
  validator (same exact-key rules as the other requests).
- Result types: `ResultReason = "teamEliminated" | "timeout" | "simultaneousWipe" |
  "abandoned"`; `winningTeam: Team | "none"`.
- Snapshot additions (`GameRoomSnapshot`): `countdownEndsAt`, `roundEndsAt` (server
  epoch ms, `0` when not applicable), `resultWinner`, `resultReason`, `resultEndedAt`.
  Bump `PROTOCOL_VERSION` only if the existing client would break; otherwise keep
  it and record why.
- A pure, unit-tested function for swept pair contact (and, if useful, round-outcome
  evaluation from alive counts) so the rules are testable without Colyseus.

## Server (`apps/server`)

State machine (contract §1): `lobby → countdown → playing → results → lobby`.

- **`startMatch`** (host, lobby, balanced teams — unchanged checks): sets roundId, seed,
  spawns, `countdownEndsAt = now + countdownMs`, phase `countdown`.
- **Countdown:** when `now ≥ countdownEndsAt` → phase `playing`, set
  `roundEndsAt = playingStart + roundDurationMs`. Movement runs only in `playing`.
- **Balance loss in countdown** (a participant leaves so teams are unbalanced or a
  side is empty) → cancel: phase `lobby`, round state cleared, participants and teams
  kept.
- **Playing tick:** move alive players; evaluate all hunter–runner contacts from one
  snapshot, eliminate every contacted runner together (`alive = false`); then
  evaluate the winner; then timeout. At the deadline process movement/contact only
  through `roundEndsAt` (no extra portion of the step).
- **Round end → `results`:** hunters win when all runners are gone; runners win when
  all hunters are gone (not reachable in T5 baseline, but the evaluator must support
  it for T7); both teams wiped in the same step → draw (`winningTeam: "none"`,
  `simultaneousWipe`); both teams alive at deadline → runners win (`timeout`).
  Results freeze: no movement, `setDirection` → `INVALID_PHASE`; final players and
  result remain in state until `returnToLobby`.
- **Eliminated players** stay connected spectators occupying their slot;
  `setDirection` from them → `INVALID_PHASE`.
- **`returnToLobby`** (host only → `HOST_REQUIRED`; results only → `INVALID_PHASE`;
  correlated `actionResult`): phase `lobby`, all players `alive = true`, round and
  result fields cleared, teams and participants retained. A late `setDirection` for
  the old round cannot affect the new one (`STALE_ROUND`; new roundId each round).
- **Leave/disconnect:** unchanged removal + host transfer (all phases). In `playing`,
  evaluate disconnect removals together with the tick's contact/victory batch: an
  empty side loses; same-step wipes draw; both sides empty → `abandoned` (room
  disposes when empty). Elimination vs. disconnect of the last player on each side in
  one step draws.
- Rooms never get stuck: any state reachable from a disconnect must lead to a
  decided result, the lobby, or disposal.

## Acceptance criteria

1. `startMatch` accepted → `countdown` with `roundId`, `mazeSeed`, spawns,
   `countdownEndsAt = now + 3 000`; players do not move; `setDirection` →
   `INVALID_PHASE`. At `countdownEndsAt` the phase becomes `playing` and
   `roundEndsAt = start + 180 000`.
2. Leaving during countdown so teams become unbalanced returns to `lobby` with
   teams/participants intact; a leave that keeps balance is not possible in 1v1/2v2
   (any leave unbalances), so assert the cancel for both sizes.
3. A hunter reaching a runner eliminates only that runner; same-team overlap does
   nothing; the eliminated player stays in the room, `alive = false`, and cannot
   change state.
4. Swept contact: two players that cross or swap within a single step still collide;
   tests exercise head-on crossing at the maximum step.
5. Several contacts in one tick eliminate all contacted runners together regardless
   of iteration order.
6. All runners eliminated → `results`, winner `hunter`, reason `teamEliminated`.
7. 2v2 where both teams are wiped in one step (including one eliminated + one
   disconnected) → winner `none`, reason `simultaneousWipe`.
8. Both teams alive at 180 s → winner `runner`, reason `timeout`; a contact on the
   deadline step resolves before the timeout.
9. Disconnect of a side's last player during `playing` → the other team wins; both
   sides in the same step → draw/`abandoned` per above; host transfers; no stuck room.
10. Results freeze movement; `returnToLobby`: non-host → `HOST_REQUIRED`, wrong phase →
    `INVALID_PHASE`, accepted → lobby with all alive, teams kept, round/result
    cleared; a new `startMatch` works and old-round inputs get `STALE_ROUND`.
11. Existing T3 tests and the T3/T4 client still pass; the client does not crash on
    countdown/results phases.
12. `npm run check` (typecheck, tests, build) passes.

## Validation

`npm ci && npm run check` in the worktree. Server tests use an injectable clock and
seed source and drive the room deterministically (no sleeps for the 3 s / 180 s
deadlines). Add shared unit tests for the swept-contact and outcome functions.
Browser/phone verification is not claimed for T5 (no HUD until T6).

## Handoff

Builder reports: files changed, new constants and wire fields, any deviation from
this spec (with reason), commands run with results, test gaps, and the three-way
reconciliation (spec ↔ change ↔ tests). Escalate before changing the approved
contract, bumping `PROTOCOL_VERSION`, or touching T4 client files beyond a crash fix.
