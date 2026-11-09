# Shared game contract

**Date:** 2026-11-09 · **Status:** Approved baseline; T1 skeleton authorized (D045)
**Coordinator:** David · **Reviewer:** Chase
**Sources:** [Confirmed decisions](./DECISIONS.md), [product brief](../PROJECT-BRIEF.md),
[delivery plan](../DELIVERY-PLAN.md).

## Approval boundary

The team reported review complete and approved this baseline on 2026-11-09
(decision D044). This includes the proposed interfaces and clarifications below.
Labels such as "proposed" describe their drafting origin, not a pending approval.
Explicitly unspecified values and tunable settings remain implementation follow-ups;
approval does not establish measured performance or browser compatibility.
No application code, dependencies, servers, or deployments are created by this document.
The team subsequently authorized T1 only; see D045 for the implementation boundary.

## 1. State machine

`lobby → countdown → playing → results → lobby`

- Only the server changes phases. A room holds at most four connected participants.
- Players choose teams in the lobby, capped at two per team. A match needs balanced
  1v1 or 2v2 teams. The host requests start; countdown lasts three seconds.
- Losing balance cancels countdown and returns to lobby.
- No mid-round joins. Proposed clarification: reject joins during countdown and
  results too; join admission is lobby-only to avoid changing an active roster.
- Eliminated players remain connected spectators and occupy their room slot.
- After results, host may return everyone to lobby, retaining connected participants
  and teams while resetting round state. Nobody automatically becomes a spectator
  in the next round.
- Disconnect removes a participant. In lobby, transfer host to a remaining participant;
  delete an empty room. Proposed clarification: transfer host in other phases too,
  so a remaining player can return the room to lobby after results.
- During play, an empty side loses; both sides empty means abandon/cleanup.
  Evaluate same-step disconnects together. There is no seamless reconnect.
- Proposed: an explicit leave follows the same removal rules as disconnect.

## 2. Client requests (proposed wire interface)

Use the chosen Colyseus client's room-creation/join mechanisms; do not build a
second WebSocket room protocol alongside them. Creation returns an opaque room
identifier usable as a private join code initially; exact code format is unapproved.

| Request | Proposed payload | Server guard / result |
|---|---|---|
| Create / join | protocol version, display name; room code for join | Validate version/name, phase and capacity; assign server-side player identity. |
| `chooseTeam` | request ID, `hunter` or `runner` | Lobby only; enforce team capacity; publish accepted state. |
| `startMatch` | request ID | Host only, balanced roster, lobby only; begin countdown. |
| `setDirection` | round ID, increasing input sequence, `up/down/left/right` | Alive current-round participant during play only; server queues desired turn. |
| `returnToLobby` | request ID | Host only, results only; reset round state and publish lobby. |
| Leave | Colyseus leave operation | Apply removal and cleanup policy. |

Never accept client identity overrides, positions, speed, pickup claims,
eliminations, effect deadlines, phase changes, or winner declarations.
Runtime-validate payloads; a shared TypeScript type alone does not validate network input.

Every non-movement request gets an accepted/rejected response correlated by request ID.
Movement uses an authoritative last-processed input sequence, not a success response
for every packet. Reject malformed input visibly; discard already-processed
sequences without replaying them. Proposed safeguards: bounded payloads and
per-connection rate limits; exact limits require review.

## 3. Authoritative state (proposed shape)

| State | Minimum fields / meaning |
|---|---|
| Room | protocol version, room ID/code, host player ID, phase, monotonically increasing state revision |
| Round | unique round ID, map ID/version, countdown end, start/deadline, global vulnerability end, vulnerability pickup respawn time |
| Player | server ID, display name, team/unassigned in lobby, alive status, position, current direction, queued direction, speed/shield deadlines, last processed input sequence |
| Pickup | stable ID, kind (`speed`, `shield`, `vulnerability`), cell, active/consumed state, next eligible spawn time |
| Result | winning team or no winner; reason (`teamEliminated`, `timeout`, `simultaneousWipe`, `abandoned`), end time |

Proposed coordinates: tile units, integer maze cells, fractional player positions.
Both client and server use the same map definition; server alone resolves movement.
Facing, speed, and team/effect colors must be derivable without client combat guesses.
Preserve final participant/results information until returning to lobby; a transport
disconnect must not make the result impossible to render.

Use authoritative server simulation time for all deadlines. Effects are active while
`now < endTime`; at equality they have expired. Publish server time alongside state
so clients can estimate remaining time; local timers are display-only.
New round IDs prevent delayed inputs from a previous round applying after replay.

Proposed initial tuning: fixed 30 Hz server simulation and approximately 20 Hz state
patching, with client interpolation. These are engineering starting points to measure,
not agreed device frame-rate or latency guarantees. Do not require client prediction
for the first integrated slice; assess touch responsiveness on real phones early.

## 4. Movement and deterministic event resolution

**Approved:** movement is continuous. A direction request queues a turn at the next
legal turn point; releasing touch does not stop movement. Walls and blocking opponents
stop progress; movement resumes when legal. Teammates pass through each other.
Turning must not require frame-perfect touch timing.

**Approved ordering:** expire ended effects → resolve movement/walls → award pickups
→ evaluate all opposing contacts from one post-pickup snapshot → apply eliminations
together → evaluate team victory → evaluate timeout.

No player eliminated by one contact can cause a different result merely because
its contact was iterated first. At a deadline, process only movement/contact through
the deadline, not the extra portion of a simulation step beyond it.

Pickup arrival time determines the claim. Exact ties use a server-seeded player
ordering randomized once per round, stable throughout that round. Keep test seeds
controllable; do not use network packet arrival as the pickup tiebreaker.

**Technical details still for review:** collision bounds/contact tolerance, movement
speed in tile units, buffered reversal behavior between junctions, spawn separation,
and merging disconnects with the collision/victory batch. Prevent fast characters
crossing opponents or pickups undetected; use swept/path-aware contact detection
or bounded substeps rather than end-position overlap alone.

## 5. Contact outcomes

| Hunter state | Runner state | Outcome |
|---|---|---|
| Global vulnerability inactive, or hunter shield active | Runner shield inactive | Runner eliminated |
| Global vulnerability inactive, or hunter shield active | Runner shield active | Neither eliminated; opposing contact blocks |
| Global vulnerability active and hunter shield inactive | Either runner shield state | Hunter eliminated |

No attack button, stun, projectile, or automatic mutual elimination on a single
contact. Different contacts within a step may still eliminate both teams; that draws.
Hunters win when all runners are gone; runners win when all hunters are gone.
If both teams survive deadline processing, runners win at 180 seconds.

## 6. Pickup timing

- Both teams: speed 1.5x for five seconds and shield for three seconds.
  Repeated same-type collection refreshes duration, not strength; different effects overlap.
- Runners only: global vulnerability for eight seconds; refresh, never stack.
  Hunter shields retain independent timers and override vulnerability while active.
- Initially one pickup of each kind. Randomize distinct reachable, walkable,
  unoccupied cells, excluding player spawn cells. Hunters cannot consume vulnerability.
- Speed/shield respawn 15 seconds after collection.
- Vulnerability respawn countdown begins when global vulnerability ends, then waits
  ten seconds. Example: collect at 0s → effect ends at 8s → next pickup at 18s.
  Individual shields do not postpone this schedule.
- If no valid cell exists, retry next tick. No spawning or effect carryover after round end.
- A second vulnerability pickup cannot normally occur during the active window with
  this single-pickup schedule; refresh semantics remain defined for tests/future maps.

## 7. Visible failures (proposed codes)

`ROOM_NOT_FOUND`, `ROOM_FULL`, `JOIN_CLOSED`, `TEAM_FULL`, `TEAMS_UNBALANCED`,
`HOST_REQUIRED`, `INVALID_PHASE`, `INVALID_INPUT`, `STALE_ROUND`,
`PROTOCOL_MISMATCH`, `RATE_LIMITED`.

Present actionable messages for rejected user actions and connection failures.
Do not silently redirect players into a different room or report success for a
rejected action. Expected stale/duplicate movement handling need not produce toast
spam; preserve enough diagnostic information to investigate failures.

## 8. Acceptance scenarios for contract review

1. Balanced 1v1 and 2v2 start; unbalanced start is rejected; lost balance cancels countdown.
2. Full/unknown/non-lobby rooms produce explicit join failures; only host starts/resets.
3. Direction buffering turns legally; touch release preserves motion; walls block;
   teammate overlap works; fast opposing crossings cannot evade contact.
4. Test every contact-table row, including exact shield/global expiry.
5. Same-step pickup changes that step's combat; multiple contacts use one snapshot;
   seeded tie priority makes tests repeatable.
6. All opponents eliminated wins; simultaneous team wipe draws; surviving teams at
   180s award runners victory; deadline contact resolves before timeout.
7. Speed/shield refresh without stacking; vulnerability follows the 0/8/18s example;
   invalid spawn cells are excluded and unavailable cells cause retry.
8. Disconnect/leave removes players, transfers host, cancels countdown when needed,
   resolves empty-side outcomes, and cleans up empty rooms.
9. Results → lobby resets effects/alive state; old-round input cannot affect a new round.
10. Malformed/spoofed/excessive requests cannot change authoritative truth; errors
    and connection failures remain visible and diagnosable.

## Approval and change control

David coordinates and Chase reviews contract changes. Baseline approval is recorded
as D044 in the decision log; record subsequent amendments there before changing
shared interfaces. Task owners, actual phone/browser matrix, and measured performance
targets remain to be assigned; this document does not assert compatibility.
