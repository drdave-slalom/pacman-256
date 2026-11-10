# Maze Workshop

Original mobile-web maze-chase workshop project. T1 shipped a runnable skeleton
(Phaser rendering, a Colyseus connection check, shared protocol/rule constants).
T2 adds the first gameplay slice in the client: a neon-styled maze generated at
the start of every game (seeded, deterministic), continuous movement with
buffered turns and wall collisions, and D-pad / swipe / keyboard steering.
Private rooms, synchronized multiplayer movement, and combat remain later tasks
(T3+).

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
ephemeral local port. They verify shared tuning, protocol guards, health, state
synchronization, and incompatible-version rejection. `npm test` also runs the
tests for the staged-documentation update script
(`scripts/update-staged-docs.test.mjs`). No cloud account is required.
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
| [apps/client](./apps/client/) | Phaser/Vite browser client and local proxy |
| [apps/server](./apps/server/) | Colyseus server, diagnostic room, and integration tests |
| [packages/shared](./packages/shared/) | Browser/server protocol, types, and approved tuning |
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
- **Server restart:** diagnostic rooms are in memory. Rerun the connection check;
  no reconnect or persistence behavior is implied.
