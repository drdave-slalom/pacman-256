# Maze Workshop

Original mobile-web maze-chase workshop project. T1 shipped a runnable skeleton
(Phaser rendering, a Colyseus connection check, shared protocol/rule constants).
T2 added a neon-styled seeded maze, continuous movement with buffered turns and
wall collisions, and D-pad / swipe / keyboard steering. T3 added private rooms and
server-authoritative synchronized movement: create or join a room by code, pick
teams, and the host starts a round in which every client sees every player move.
T5 adds a server-driven 3-second countdown, hunter-on-runner contact elimination,
round outcomes (team elimination, timeout, simultaneous wipe, disconnects), and
host return-to-lobby. T6 adds the match HUD (phase, timer, alive counts),
spectator mode, and a results overlay that shows exactly what the server declared;
the client never guesses the winner. T7 adds three server-owned pickups and
conditional contact combat: △ Speed (1.5x, 5s), □ Shield (3s), and runner-only
◇ Reverse (global hunter vulnerability, 8s). Speed/shield respawn after 15s;
Reverse respawns 10s after its global window ends. Independent T7 review/QA
and physical-phone acceptance remain pending.

## Requirements and quick start

- Node.js **22.18+** (prefer a maintained LTS release such as Node 24).
- npm **10+**.

From the repository root:

```bash
npm ci
npm run dev
```

One command starts shared-package compilation in watch mode, the server, and Vite.
Press Ctrl+C to stop all three. The client port is strict: startup fails if 5173
is occupied rather than silently selecting a different URL.

### Two-browser walkthrough

1. Open **http://localhost:5173** in two browser windows (or two browsers).
2. **Window A:** enter a display name (1-16 characters) and choose **Create room**.
   The lobby shows the room code; **Copy** puts it on the clipboard (if the
   browser blocks clipboard access, the code is shown to share manually).
3. **Window B:** enter a name, paste the code, and choose **Join**.
4. Each player picks **Hunters** or **Runners** (teams have no per-player cap;
   any size up to the four-player room is allowed). The lobby shows a live
   `Hunters: N · Runners: M` counter.
5. The host (the room creator, marked in the player list) sees **Start match**
   and presses it once every player has picked a team and each team has at least
   one player. Start stays disabled until then. Rosters may be unbalanced (e.g.
   3v1) and show a warning only. The server runs a 3-second countdown (no
   movement or input), then the round starts.
6. Steer with the D-pad, a touch swipe on the play area, or arrow keys/WASD
   (mouse drags do not steer). Both
   windows show every player as a team-colored ghost mascot (hunters yellow,
   runners cyan) whose pupils glance toward the direction of travel; your own
   player has a white outline and a pulsing white ring. The client only sends
   direction intent; the server moves players and the client interpolates between
   updates. Collect △ Speed or □ Shield as either team; only runners collect
   ◇ Reverse. Normally a hunter eliminates an unshielded runner on contact;
   runner shields block opposing contact. During global reversal an unshielded
   hunter is eliminated by runner contact; a hunter's own shield overrides
   reversal until its independent timer expires. The HUD displays local effect
   and global reversal seconds; explicit □ SHIELD / ◇ EXPOSED player labels
   distinguish protection from vulnerability without relying on color.
   Eliminated players stop moving and their input is
   ignored. The round ends when a team is eliminated or at the 180-second deadline
   (runners win). In the results phase the lobby panel shows a one-line result
   taken from the server's `resultWinner`/`resultReason` (never inferred locally),
   and the host gets a **Back to lobby** button that sends `returnToLobby` (teams
   kept); non-hosts see the result and wait for the host. Team buttons and Start
   are hidden outside the lobby phase. During countdown/playing/results, the
   game view shows the match HUD (timer, alive counts) and, for an eliminated
   local player, a spectator overlay; the results overlay (T6) shows the server
   result line with the host's **Back to lobby** control.
7. **Leave** returns to the join screen. When the host leaves, the
   earliest-joined remaining player becomes host. If a leave during the
   countdown empties a side (no hunters or no runners left), the room cancels
   back to the lobby; otherwise the countdown continues (e.g. 2v2 becomes 2v1).

The current view is mirrored in the URL hash, so a refresh restores it:
`#room=<code>` reopens the room and attempts to rejoin with the display name
remembered from the previous session. The join screen is the default (no hash).
An invalid code in the hash shows a message instead of attempting to join.

Errors are shown on the page, and the UI returns to a usable state:

- Join: empty or invalid name, missing code, unknown or malformed code
  (`ROOM_NOT_FOUND`), room already has four players (`ROOM_FULL`), match already
  started (`JOIN_CLOSED`), outdated client (`PROTOCOL_MISMATCH`).
- Lobby: the client shows notices when players have not picked a team, when a
  side is empty ("Need at least one hunter and one runner to start."), and when
  the roster is unbalanced (warning only; start is still allowed). Start is
  disabled until everyone has picked and each team has at least one player.
  Server rejections surface the server-provided message (falling back to the
  mapped error-code text). (The server also enforces `HOST_REQUIRED`; non-hosts
  do not see the Start button.)
- Disconnects: a dropped connection or server restart shows a message and returns
  to the join screen. There is no automatic reconnect.

The **Server connection check** section (below the panels) keeps the T1
diagnostic: **Check server connection** must report `Connected: shared protocol v1, authoritative lobby state received.` and
uses a disposable diagnostic room.

## Server game room (T3, extended by T5)

The server registers a private game room (`GAME_ROOM`, `"game"`) next to the
diagnostic room. Integration tests exercise it with real Colyseus SDK clients.

- **Join:** the room code is the opaque Colyseus room ID. Create and join validate
  the protocol version and display name (trimmed, 1-16 characters, no control or
  invisible format characters) and reject unknown options. Rooms are private
  (not listed for matchmaking), hold up to four players, and admit joins only in
  the lobby phase. A started room that already has four players reports
  `ROOM_FULL`; otherwise a started room reports `JOIN_CLOSED`.
- **Lobby:** `chooseTeam` has no per-team cap; `startMatch` requires the host,
  every player assigned to a team, and at least one hunter and one runner
  (D054). An empty side or an unassigned player is rejected with `INVALID_INPUT`
  and a specific message (the server never emits `TEAM_FULL` or
  `TEAMS_UNBALANCED`; both codes remain contract-visible, and unbalance is a
  client-side warning only). Replies are `actionResult` messages correlated by
  `requestId`, and rejections may carry a custom `message`. A malformed request
  whose `requestId` cannot be read gets an uncorrelated `inputRejected` instead.
- **Countdown (T5):** `startMatch` enters `countdown` (`countdownEndsAt` =
  start + `GAME_RULES.countdownMs`). Players are placed but cannot move, and
  `setDirection` is rejected with `INVALID_PHASE`. If a disconnect leaves a side
  empty (no hunters or no runners, D054), the room cancels to the lobby (teams
  kept, round fields cleared); an unbalanced but non-empty roster keeps counting
  down.
- **Play:** on start the server picks a new maze seed and round ID, syncs them to
  clients (which regenerate the maze from the seed), and places players on
  distinct spawn cells. `findSpawnCells` returns three per team: hunters in the
  top half (left, right, center-top) and runners in the bottom half (left, right,
  center-bottom), so a 3-player team (e.g. 3v1) can spawn; wall-adjacent cells
  are preferred so players start still. It runs a fixed 30 Hz simulation
  with the shared movement module and patches state about every 50 ms. When the
  countdown ends the phase becomes `playing` with `roundEndsAt` = countdown end +
  `GAME_RULES.roundDurationMs`. Simulation follows round-relative server time:
  `planSimulationSteps` catches up a delayed tick in full fixed steps
  (`SIMULATION_STEP_MS`), carries leftover time below a step to the next tick,
  and adds one final partial step at the deadline, so movement and contact are
  processed up to the deadline and never beyond it. The round stops stepping as
  soon as it ends. Teammates pass through each other.
- **Contact and outcome (T5):** each step moves players, then checks every
  hunter × runner pair with a swept (path-aware) contact test
  (`CONTACT_DISTANCE_TILES`, 0.6 tiles) against one snapshot, so results are
  order-independent. Contacted runners are eliminated (`alive: false`), stop, and
  stay listed as spectators. `evaluateRoundOutcome` then decides, in order:
  both teams already empty (`none/abandoned`), both emptied this step
  (`none/simultaneousWipe`), no runners (`hunter/teamEliminated`), no hunters
  (`runner/teamEliminated`), deadline reached (`runner/timeout`). The snapshot
  carries `resultWinner`, `resultReason`, and `resultEndedAt`, and the phase
  becomes `results`. Disconnects remove players before evaluation, so an emptied
  team loses.
- **Return to lobby (T5):** in `results`, the host sends `returnToLobby`
  (`{ requestId }`); non-hosts get `HOST_REQUIRED`, other phases
  `INVALID_PHASE`. Alive state, queued directions, maze seed, round ID, and all
  countdown/deadline/result fields reset; connected players and teams are kept.
- **Input:** `setDirection` is checked for payload, phase, round ID, and sequence.
  Malformed, out-of-phase (countdown, results, or an eliminated sender), and
  stale-round input is rejected with `inputRejected`; repeated or older sequences
  are silently dropped. Input over 20 per second is dropped, with at most one
  `RATE_LIMITED` notice per second. A client sending more than 60 messages per
  second is disconnected; other players are unaffected.
- **Leave:** host transfers to the earliest-joined remaining player; Colyseus
  disposes empty rooms.
- **Test hooks:** `createGameServer` accepts trusted `clock` and `spawnPlacer`
  options (alongside `mazeSeedSource`) so tests can drive phase deadlines and
  force contacts. Production rooms use `Date.now` and default spawns.

### T7 pickups and conditional combat

The server publishes `pickups` (stable kind IDs, cells, active flags, next spawn
times), per-player `speedEndsAt`/`shieldEndsAt`, `vulnerabilityEndsAt`,
`vulnerabilityRespawnAt`, and `simulationTime`. Effects are active strictly
before their deadlines. Simulation time, not client wall time, drives the effect
HUD. Repeated collection refreshes rather than stacks; different effects coexist.
Spawning excludes spawn cells, occupied cells, other pickups, walls and unreachable
cells, using a reproducible seeded server stream. Unavailable cells retry next
simulation tick. No pickup request or client effect declaration is accepted.

Movement traces record actual cell-center segments, buffered turns and wall stops.
Pickup arrival time wins; exact ties use a once-per-round seeded player priority.
After movement and pickup awards, all contacts use one effect snapshot; eliminations
apply together, then victory precedes timeout. Existing shielded opposing contacts stop movement at
the contact boundary and allow retreat. Stops resolve chronologically through
multi-player chains, bounded by the number of players. Pickup candidates are
processed in arrival order. A new shield blocks the remaining movement from its
acquisition time, including later contacts in that same step; committed arrivals
are never rewound. Remaining pickup candidates are rechecked on the retained
paths. All combat contacts use the common post-pickup snapshot, including contacts
before acquisition. Team contacts do not block. The simulation
cursor clamps at the round deadline. Results stop pickups/effects progressing;
return-to-lobby clears them for replay.

Focused T7 coverage (build shared first, as root scripts do):

```bash
npm --workspace packages/shared run build
node --experimental-strip-types --test packages/shared/src/pickups.test.ts apps/server/src/movement-resolution.test.ts apps/server/src/game-room.test.ts apps/client/src/hud-view.test.ts
```

These include real-room SDK checks, not physical-device acceptance. T8 owns four
physical devices; T9 owns the named browser/device and performance matrix. Live
phone readability of pickup and hunter-state cues, touch controls, and orientation
changes still needs that human validation.

## Client (T3)

- `apps/client/src/main.ts` owns the DOM flow (join, lobby, game panels), the
  Colyseus connection, URL-hash view restore (via shared `parseAppRoute` /
  `serializeAppRoute`), the remembered display name (`localStorage`), and the
  single direction-request path shared by D-pad, swipe, and keyboard. Input
  outside an active round, or from a player who is not alive (spectating), is
  dropped. The Phaser game exists only during a round, so key capture never
  blocks typing in forms.
- `apps/client/src/maze-scene.ts` renders the server-seeded maze and interpolated
  players as ghost mascots (domed body, scalloped feet, eyes that glance along
  the direction of travel); it never moves players itself.
- `apps/client/src/session-model.ts` holds pure, unit-tested helpers (no
  DOM/Phaser): round detection and snapshot mapping; `resultSummary` (one-line
  round result from the server's winner/reason, `null` outside `results`);
  `DirectionSender` (sends
  only direction changes, sequences from 0 per round, and stays within a
  16-per-second budget below the server limit, holding the latest change while
  over budget); `PendingAction` (one in-flight
  `chooseTeam`/`startMatch`/`returnToLobby` until
  its reply, an uncorrelated `INVALID_INPUT`, or a timeout; rejected outcomes
  carry the server's optional `message`); room-code checks;
  interpolation; and player-facing disconnect messages.

## Commit-time documentation updates

The installed pre-commit hook uses the GitHub Copilot CLI to update docs when
staged application, shared-package, build, deployment, or delivery-plan
task-status changes require it. Copilot may update and stage `README.md` and, for
deployment changes, `deploy/README.md`. It can propose monotonic task-status
advances in the Delivery Plan, but cannot mark a task `Complete`; a human records
that after acceptance criteria are verified. The hook then updates only the
marked Implementation Status block in `PROJECT-BRIEF.md` from the plan's status
column. It never rewrites acceptance criteria or plan prose, or edits
`docs/DECISIONS.md` and `docs/GAME-CONTRACT.md`; changes that may require updates
to those approved sources stop for human review. Documentation-only commits skip
Copilot; a staged Delivery Plan status edit only syncs the brief status block.

The hook sends a size-limited staged diff and relevant docs to Copilot. It blocks
common credential patterns, but that check is not exhaustive; never stage
secrets. Install and authenticate GitHub Copilot CLI (`copilot` on `PATH`) before
committing implementation changes. `npm ci` installs the hook in a local clone
(via the root `prepare` script); existing clones can run `npm run hooks:install`.
`npm run docs:update-staged` runs the documentation update step on the currently
staged changes. If Copilot fails or returns an invalid update, the commit is
stopped. Review generated documentation before completing the commit.

## Phone access over the local network

1. Connect the development machine and phones to the same trusted Wi-Fi.
2. Find the machine's LAN address in network settings, or use the Network URL
   printed by Vite.
3. Open `http://<machine-LAN-IP>:5173` on the phone and create or join a room (or
   run the connection check). Do **not** use `localhost` on a phone; that
   addresses the phone itself.
4. Repeat on each target browser.

Two-phone play over the LAN has **not yet been validated** on physical iOS/Android
devices; that check, and a polished mobile lobby, belong to T4. Clipboard copy
may be unavailable over plain HTTP on a phone; share the displayed code instead.

Vite listens on `0.0.0.0`. It proxies `/multiplayer` HTTP and WebSocket traffic to
the server on loopback port 2567, so phones need only reach port 5173. The same
browser-origin URL avoids hardcoded hostnames and mixed-content WebSockets.
`PORT=2568 npm run dev` changes the backend port and the proxy target together.

Allow inbound traffic for the development server if prompted by the OS firewall.
Guest/workshop Wi-Fi may isolate devices: use a permitted shared network/hotspot
if phones cannot reach the machine. Do not disable your firewall or expose this
development server to the public internet. HTTP/LAN access is for local testing,
not production hosting or validation of HTTPS-only browser features.

## Validation

```bash
npm run typecheck
npm test
npm run build
# All three:
npm run check
```

Tests use Node's built-in runner and real HTTP/WebSocket connections on an
ephemeral local port. They verify shared tuning, app-route hash parsing and
serialization, protocol guards and validators
(display names, join options, room messages including `returnToLobby`, error-code
mapping), spawn-cell placement across many maze seeds (three distinct cells per
team), swept contact and round
outcome rules (`round.test.ts`), health, state synchronization, and
incompatible-version rejection. Game-room integration tests (`game-room.test.ts`)
use an injectable fake clock and cover private-room join/failure codes, team
selection without a cap, host-only start with every player assigned (2v1, 3v1,
and 2v2 start; unassigned players or an empty side are rejected), countdown,
synchronized movement, contact elimination, timeout and
disconnect outcomes, return to lobby, input rejection and rate limiting, flood
disconnect, and host transfer/room disposal. They also
cover simulation catch-up: `planSimulationSteps` unit cases (full-step catch-up,
carried leftovers, no step beyond the deadline), a delayed tick simulating all
elapsed time, and a catch resolved in the final 100 ms across a delayed deadline
tick. Client unit tests (`apps/client/src/*.test.ts`)
cover the session model: input dedupe/sequencing/rate budgeting, pending-action
resolution, room-code validation, interpolation, leave messages, and the
result-summary lines. The DOM and
Phaser wiring in `main.ts`/`maze-scene.ts` has no automated tests. `npm test`
also runs the tests for the staged-documentation update script
(`scripts/update-staged-docs.test.mjs`), the software-factory smoke tests
(`scripts/factory-smoke.test.mjs`), the label-sync script tests
(`scripts/sync-labels.test.mjs`), and the agent-pipeline gate tests
(`.github/scripts/agent-gate.test.mjs`). No cloud account is required.
`npm run build` emits shared/server JavaScript and client static assets.

After building, `npm start` runs the compiled server. The built client is in
`apps/client/dist`; see `deploy/` for the Kubernetes deployment, where one
container serves both the static assets and the Colyseus server (the production
client connects to the same-origin root). `npm start` alone does not serve the
client. In local dev, the Vite dev server serves the client and proxies
`/multiplayer` (stripping the prefix) to the backend.

Phaser currently causes a large-bundle warning during the client build; the build
succeeds. Mobile download/performance optimization remains follow-up work.

## Factory control (operation)

The `factory-control/` workstream ships a control server (snapshot + guarded
action API + read-only web mirror) and a **pi TUI extension** (`/factory`) for
operating the factory from inside a pi session. See
[`factory-control/README.md`](factory-control/README.md) and
[`factory-control/tui/README.md`](factory-control/tui/README.md).

Quick start:

```bash
npm run factory:control:serve   # control server (127.0.0.1:4780)
# in a pi session (project trusted): open the Factory screen
#   /factory          # live board
#   /factory <query>  # filter units
```

The TUI extension is loaded via `.pi/extensions/factory-control.ts`; it only
mutates through the M2 prepare/execute protocol and never re-renders the Herdr
widget.

Factory units can also run on GitHub without a local session: label an issue
`agent:go`, approve the spec with `/approve-spec`, and the Copilot cloud agent
builds while review and QA workflows gate the merge. See
[GitHub agent pipeline (cloud mode)](docs/FACTORY.md#github-agent-pipeline-cloud-mode).

## GitHub Actions

The [CI workflow](./.github/workflows/ci.yml) runs on pull requests, pushes to
`main`, and manual dispatch from the Actions tab:

- Clean lockfile install, typechecks, tests, and production builds on Node
  **22.18.0** (minimum supported) and **24.x**.
- Read-only repository permissions, a 15-minute job timeout, and cancellation of
  superseded runs on the same ref.
- On `main` pushes or manual runs, the Node 24 job uploads a seven-day build
  artifact named `maze-workshop-<commit SHA>`. Pull requests validate only.

The artifact contains compiled client/server/shared output, workspace manifests,
the root lockfile, and this README. Download and extract its `.tgz`, run
`npm ci --omit=dev`, then `npm start` for the backend. Build/typecheck/dev commands
require the source checkout and development dependencies; they are not artifact
commands. The static client is served by the game server itself (see `deploy/`);
no separate web host or proxy is required in the deployed setup.

This is CI plus build-artifact delivery, **not automatic cloud deployment**.
AWS/Azure hosting remains deferred. No cloud credentials or GitHub secrets are
needed. Once the hosting target is selected, add an environment-approved deployment
job using these verified outputs rather than deploying untested PR code.
To enforce CI before merge, configure the two `Validate` jobs as required checks
in GitHub branch protection/rulesets; the workflow alone does not enforce that.

## Layout and shared context

| Location | Responsibility |
|---|---|
| [apps/client](./apps/client/) | Phaser/Vite browser client (join/lobby/game UI, maze scene), session model, and local proxy |
| [apps/server](./apps/server/) | Colyseus server, diagnostic room, private game room, and integration tests |
| [packages/shared](./packages/shared/) | Browser/server protocol (room messages, validators, error codes), app-route hash helpers, types, maze/spawn logic, contact/round-outcome rules, and approved tuning |
| [Game contract](./docs/GAME-CONTRACT.md) | Approved behavior and interface baseline |
| [Decision log](./docs/DECISIONS.md) | Durable team decisions and implementation context |
| [Delivery plan](./DELIVERY-PLAN.md) | Task boundaries and milestones |
| [Project brief](./PROJECT-BRIEF.md) | Product direction |

Use the root lockfile and `npm ci` for a repeatable install. The project-local npm
cache lives under ignored `.cache/npm`; no global cache permission changes are needed.
Compiled output, dependencies, and the local AE Toolkit checkout remain ignored.

## Troubleshooting

- **Cannot connect:** check the server terminal and
  `http://localhost:5173/multiplayer/health`; expected response is
  `{"status":"ok","protocolVersion":1}`. Failures are shown in the page and console.
- **Port occupied:** stop the specific conflicting process or choose another backend
  `PORT`. Do not launch multiple development stacks in the same working directory.
- **Shared package not found:** run commands from the root; root scripts build the
  shared package first. Workspace-only commands assume that build already exists.
- **Server restart:** rooms are in memory and there is no reconnect; the client
  returns to the join screen with a message. Create or join a room again.
