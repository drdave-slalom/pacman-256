# Maze Workshop

Original mobile-web maze-chase workshop project. T1 shipped a runnable skeleton
(Phaser rendering, a Colyseus connection check, shared protocol/rule constants).
T2 adds the first gameplay slice in the client: a neon-styled maze generated at
the start of every game (seeded, deterministic), continuous movement with
buffered turns and wall collisions, and D-pad / swipe / keyboard steering.
T3 adds a private `GameRoom` on the server (see below): join validation, team
selection, host-started matches, and authoritative 30 Hz movement. The client
has a tested, DOM-free session model (`apps/client/src/session-model.ts`) for
this room; countdown, contact combat, pickups, and round end remain later tasks.

## Requirements and quick start

- Node.js **22.18+** (prefer a maintained LTS release such as Node 24).
- npm **10+**.

From the repository root:

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**. You should see a newly generated neon maze with
a player blob you can steer (D-pad, swipe, or arrow keys/WASD; a maze seed is
shown for reproducibility). A **Check server connection** button remains below:
clicking it must report `Connected: shared protocol v1, authoritative lobby
state received.` The check creates a disposable diagnostic room and leaves it;
it does not create a playable private match.

One command starts shared-package compilation in watch mode, the server, and Vite.
Press Ctrl+C to stop all three. The client port is strict: startup fails if 5173
is occupied rather than silently selecting a different URL.

## Server game room (T3)

The server defines a private game room (`GAME_ROOM`) alongside the diagnostic
room. It is exercised by integration tests with real Colyseus SDK clients.

- **Join:** protocol version and display name are validated on create and join;
  unknown options are rejected. Rooms are private (join by room code, not
  matchmaking), hold up to four players, and admit joins in the lobby only.
  Failures map to shared error codes (`ROOM_NOT_FOUND`, `ROOM_FULL`,
  `JOIN_CLOSED`, `PROTOCOL_MISMATCH`, `INVALID_INPUT`).
- **Lobby:** `chooseTeam` enforces team capacity; `startMatch` requires the host
  and balanced teams (1v1 or 2v2, no unassigned players). Results are returned
  as `actionResult` messages correlated by `requestId`.
- **Play:** the server picks a per-round maze seed, places players on distinct
  spawn cells, and runs a fixed 30 Hz simulation using the shared movement
  module. `setDirection` input is validated (round ID, increasing sequence,
  direction); malformed, stale, out-of-phase, and rate-limited input is rejected
  with `inputRejected`, and duplicates are dropped. Exceeding the hard message
  cap disconnects only the offending client.
- **Leave:** host transfers to the earliest remaining player; empty rooms are
  disposed.

## Client session model (T3)

`apps/client/src/session-model.ts` holds pure helpers (no DOM/Phaser) for the
client side of the game room:

- Round detection and maze identity (`isRoundActive`, `mazeKey`) and
  snapshot-to-view mapping (`playerViews`).
- `DirectionSender`: sends `setDirection` only on direction changes, sequences
  from 0 per round, and keeps a client-side budget below the server rate limit.
  Changes made over budget are held (latest wins) and flushed when budget frees,
  including a re-hold after a `RATE_LIMITED` rejection.
- `PendingAction`: tracks one in-flight `chooseTeam`/`startMatch` request until
  its correlated accept/reject, an uncorrelated `INVALID_INPUT`, or a timeout.
- `isPlausibleRoomCode`, `Interpolator` (glides between patches, snaps on large
  jumps), and `leaveMessage` (player-facing text for unexpected disconnects).

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
3. Open `http://<machine-LAN-IP>:5173` on the phone and run the connection check.
   Do **not** use `localhost` on a phone; that addresses the phone itself.
4. Repeat on each target browser. This skeleton has not yet been verified on
   physical iOS/Android devices.

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
ephemeral local port. They verify shared tuning, protocol guards and validators
(display names, join options, room messages, error-code mapping), spawn-cell
placement across many maze seeds, health, state synchronization, and
incompatible-version rejection. Game-room integration tests (`game-room.test.ts`)
cover private-room join/failure codes, team selection, host-only balanced start,
synchronized movement, input rejection and rate limiting, flood disconnect, and
host transfer/room disposal. Client unit tests (`apps/client/src/*.test.ts`)
cover the session model: input dedupe/sequencing/rate budgeting, pending-action
resolution, room-code validation, interpolation, and leave messages. `npm test`
also runs the tests for the staged-documentation update script
(`scripts/update-staged-docs.test.mjs`) and the software-factory smoke tests
(`scripts/factory-smoke.test.mjs`). No cloud account is required.
`npm run build` emits shared/server JavaScript and client static assets.

After building, `npm start` runs the compiled server. The built client is in
`apps/client/dist`; see `deploy/` for the Kubernetes deployment, where one
container serves both the static assets and the Colyseus server (the production
client connects to the same-origin root). `npm start` alone does not serve the
client. In local dev, the Vite dev server serves the client and proxies
`/multiplayer` (stripping the prefix) to the backend.

Phaser currently causes a large-bundle warning during the client build; the build
succeeds. Mobile download/performance optimization remains follow-up work.

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
| [apps/client](./apps/client/) | Phaser/Vite browser client, session model, and local proxy |
| [apps/server](./apps/server/) | Colyseus server, diagnostic room, private game room, and integration tests |
| [packages/shared](./packages/shared/) | Browser/server protocol (room messages, validators, error codes), types, maze/spawn logic, and approved tuning |
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
- **Server restart:** rooms are in memory. Rerun the connection check;
  no reconnect or persistence behavior is implied.
