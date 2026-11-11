# Shared decision log

This is durable project memory for teammates and AI sessions. Read alongside the
[project brief](../PROJECT-BRIEF.md) and [delivery plan](../DELIVERY-PLAN.md).
Record confirmed decisions separately from proposals. No application implementation
was authorized by the checkpoint itself. Subsequent task authorization is recorded below.

## Confirmed baseline

Recorded 2026-11-09 from the team's product discussion and project brief:

| ID | Decision | Rationale / context |
|---|---|---|
| D001 | Mobile-first browser game with responsive orientation support. | Good touch controls are a primary demo requirement. |
| D002 | Real-time versus survival; eliminated players spectate. Start with up to four players. Individual last-survivor interpretation superseded by D009. | A complete small match is more valuable than pursuing the eventual 32-player goal during the workshop. |
| D003 | Target roughly 2-3 minute rounds. | Suits mobile sessions and workshop demonstrations. Exact timeout rules subsequently confirmed in D035/D036. |
| D004 | Private rooms first; quick play is a stretch goal. | Establish a reliable joining flow before public matchmaking. |
| D005 | Initial power-ups are speed boost and temporary shield; expanded to three by D033. | Scope change: runner-only vulnerability pickup is essential to the approved combat loop, not optional polish. |
| D006 | Original identity/assets; stylized 2D gameplay with optional depth effects. Theme remains open. | Avoid an art pipeline becoming a prerequisite for play. |
| D007 | Three-person team: two senior platform engineers and one senior software engineer; three-day workshop. | Evaluation emphasizes collaborative AI tooling as well as a playable outcome. |
| D008 | Use repository documents as shared long-term memory. | Requested by the team on 2026-11-09; decisions must survive individual chat sessions. |

These are decisions, not claims that the corresponding features exist.

## Checkpoint in progress

| Round | Resolve | Status |
|---|---|---|
| 1: Game rules | Survival threat, round outcomes, power-up behavior, movement rules | Core rules and initial pickup tuning confirmed |
| 2: Technical choices | Stack, server authority, hosting, room/disconnect rules, first device targets | Stack/session rules confirmed; local-first, cloud deferred; exact test matrix open |
| 3: Working agreements | Ownership, AI tools, shared contract, review/integration cadence | Contract approved (D044); David coordinates, Chase reviews; assign owner per implementation task |

The delivery plan's recommendations are proposals until explicitly accepted.
Moving hazards are not the chosen survival threat. Consult the confirmed checkpoint
decisions below instead of the delivery plan's initial gameplay proposals.

## Checkpoint decisions: 2026-11-09

| ID | Decision | Rationale / context |
|---|---|---|
| D009 | Team-based survival with direct attacks or tagging, rather than shared roaming enemies. | Working neutral labels are hunters and runners, not an approved theme or asset choice. Composition and combat subsequently confirmed in D023/D033. |
| D010 | Use a 180-second round cap. Initial timeout-draw proposal superseded by D016. | Team subsequently approved runners winning at timeout. |
| D011 | Teammates pass through each other; opponents must not pass through each other. | Contact behavior and movement subsequently confirmed in D015 and D018. |
| D012 | Initial tunable values: speed boost 1.5x for 5 seconds; shield for 3 seconds. Different effects may overlap; repeated same-type pickups refresh duration without multiplying strength. | Team accepted the proposed tuning. Shield interaction subsequently clarified in D034 and the current combat summary. |
| D013 | Randomized power-up pickup positions. | Spawn details subsequently confirmed in D019. |
| D014 | Four-player composition is two hunters versus two runners; players choose sides with balanced limits. | Smaller balanced lobbies subsequently approved in D023. |
| D015 | Contact tagging: hunters eliminate unshielded runners; eliminated runners spectate. Shielded opposing contact blocks movement. | Initial permanently invulnerable hunter rule superseded by D033/D034. No-button combat is retained. |
| D016 | Hunters win when all runners are eliminated; runners win if any survive 180 seconds. | Supersedes timeout-draw portion of D010. Exact event ordering for a tag at the deadline belongs in the shared rules contract. |
| D017 | Both teams can collect speed and shields; shields protect against opponent attacks. | Exact hunter interaction subsequently confirmed in D033/D034. |
| D018 | Four-direction movement with buffered turns. | Teammates pass through each other; opposing contact follows D015. Buffered turns retain a requested direction until the next legal turn point. |
| D019 | One fixed maze. Initially spawn one speed and one shield pickup on distinct reachable, walkable, unoccupied cells, excluding player spawn cells. Collected pickups respawn after 15 seconds at another valid cell; retry next tick if none exists. Server resolves simultaneous claims deterministically. | Approved as initial tunable rules. Seed/control randomness for reproducible tests; the exact arbitration ordering must be specified before implementation. |
| D020 | Runners must be able to attack hunters. | Explicit team request to resolve the hunter shield issue. Mechanics subsequently confirmed in D027/D033; no stun or button attack approved. |
| D021 | TypeScript + Phaser client and Node.js/Colyseus server, with shared protocol/rules in one repository. | Team accepted the proposed stack. Verify library/runtime compatibility and deployment requirements before scaffolding. |
| D022 | Server owns movement/collisions, input validation, power-ups, timers, elimination, and results. Clients send intent and render state. | Avoid divergent clients and client-declared game outcomes. |
| D023 | Allow balanced 1v1 and 2v2 matches. Host starts a 3-second countdown when balanced; cancel if balance is lost; reject mid-round joins. | Enables two-phone validation while preserving four-player target. |
| D024 | Remove disconnected players; if a side becomes empty, remaining side wins; if both sides are empty, abandon and clean up. Transfer lobby host to a remaining player or delete an empty room. No seamless reconnect in MVP. | Accepted simple workshop policy. Evaluate same-step disconnects together to avoid order-dependent results. |
| D025 | Use a familiar managed host; cloud will be AWS or Azure, choice pending. | No provider, service, region, account, budget, or hosting topology has been approved. |
| D026 | Support iOS and Android mobile browsers, including Safari, Chrome, Firefox, and potentially others. | Requested coverage; actual devices, versions, performance threshold, and must-pass versus best-effort matrix still need agreement. |
| D027 | Runners can eliminate hunters by collision; no separate attack button. | Team rejected the proposed stun/button mechanic. D033/D034 subsequently clarify vulnerability-dependent contact; this is not unconditional mutual elimination. |
| D028 | Loose roles: anyone can contribute to any lane. | Suggested A/B/C lane assignments are not fixed staffing. Assign a task/contract owner when taking work, rather than assuming seniority implies ownership. |
| D029 | Team AI tool is GitHub Copilot. | Make durable context discoverable to fresh Copilot sessions, not only the current chat. |
| D030 | One task per branch; separate worktrees for concurrent agents; one named contract owner; teammate review; integrate/playtest every 60-120 minutes; pair/simplify after 30 blocked minutes. Record decisions/spec changes; no secrets or unreviewed agent merges. | Team accepted the working agreement. Owner identities are not assigned yet. |
| D031 | Prioritize a working local server before cloud deployment. Defer AWS/Azure evaluation. | Explicit team preference; supersedes the delivery plan's hosted Day 1 gate. Test phone access over the local network early; do not assume phone localhost points to the development machine. |
| D032 | Reported Chrome versions: 156.x and 157.x; Safari version unknown. Strive for current-browser compatibility. | User-reported versions, not independently verified device evidence. Named devices, Firefox version, minimum versions, and 30 FPS proposal are unconfirmed. |
| D033 | Add a third, runner-only pickup that temporarily makes all hunters vulnerable. Normally a hunter eliminates a runner on contact; during vulnerability, a runner eliminates the hunter instead. No attack button. | Explicit clarification of D020/D027. Attacks are conditional on hunter vulnerability, not symmetric mutual elimination. Use original pickup visuals/name in the game. Tuning is recorded in D037/D038. |
| D034 | A hunter's active shield preserves invulnerability for the remaining shield duration, even during global vulnerability. | Once shield protection ends, the hunter is vulnerable if the global window is still active. The shield does not cancel the global effect or protect other hunters. |
| D035 | Eliminate the opposing team to win. A simultaneous wipe of both teams in one simulation step draws; if both teams survive to 180 seconds, runners win. | Explicitly accepted; extends D016 to include elimination of all hunters. |
| D036 | Resolve collisions scheduled at or before the round deadline and evaluate elimination before applying timeout victory. | Accepted deterministic deadline ordering. Exact pickup/contact ordering within one simulation step remains for the shared contract. |
| D037 | Global vulnerability lasts 8 seconds; repeated collection refreshes the window to 8 seconds, never adds duration. Shield timers remain independent. | Approved initial tuning. A hunter whose shield expires during the window becomes vulnerable for the remaining window. |
| D038 | One runner-only vulnerability pickup at round start, using D019's randomized safe-cell rules. Hunters cannot consume it. Respawn countdown is 10 seconds starting when the previous global vulnerability window ends, not when the pickup is collected. | Team changed the proposed collection-based 20-second respawn. With no refresh: collect at t=0, vulnerability ends at t=8, next pickup at t=18. Speed/shield respawns remain 15 seconds after collection. |
| D039 | Server-controlled phases: lobby, countdown, playing, results. After results, host can return everyone to lobby, resetting effects and elimination but keeping connected players and teams. | Approved replay flow; promotes this small replay convenience from Should to agreed behavior. Lobby-only admission subsequently approved in D044. |
| D040 | Continuous movement: direction requests steer/queue turns; releasing the control does not stop movement. Stop at walls or blocking opponents; resume when legal. Eliminated players cannot move. | Accepted arcade-style interaction; touch layout is still open. |
| D041 | Expire effects, resolve movement/walls, award pickups, evaluate all contacts from the post-pickup snapshot, apply eliminations together, then victory before timeout. | Approved ordering makes newly collected protection/vulnerability effective immediately and avoids contact iteration order determining results. |
| D042 | Pickup claims use arrival time; exact ties use a stable seeded player priority randomized once at round start. | Accepted deterministic tie resolution without first-network-message advantage. |
| D043 | David coordinates the shared contract; Chase reviews it. | Flexible implementation lanes remain unchanged. Proposed wire fields and technical tuning are not automatically approved by assigning ownership. |
| D044 | Team reported draft reviewed and approved the [game contract](./GAME-CONTRACT.md) as the shared baseline on 2026-11-09. T0 is complete. | Includes lobby-only admission, all-phase host transfer, explicit leave/disconnect equivalence, interface/state/error proposals, and tunable simulation starting points. Unspecified geometry/limits, task assignments, device matrix, and performance measurement remain follow-ups. Approval of the document is not a separate go-ahead to build the app. |
| D045 | Team explicitly authorized T1, the runnable skeleton, on 2026-11-09. | Scope: client/server/shared workspace, local startup, build/typecheck/tests, and local phone-access instructions. Does not authorize matchmaking/gameplay tasks or cloud deployment. |
| D046 | T2 (one maze + touch movement) implemented and validated for team review on 2026-11-10. Decisions: dual touch controls (on-screen D-pad and swipe/drag steering); one fixed 15×11 compact rectilinear maze (original layout); shared map plus a pure continuous-movement/buffered-turn module in `packages/shared` for reuse by the authoritative server; the client drives a locally authoritative prototype only (server movement is T3). | Validation: `npm run check` green; 26 top-level tests (5 map + 17 movement new; 3 shared index; 1 server with 3 subtests); dev-server smoke served the prototype page and /health protocol v1; no server files changed. Independent internal review found no blockers. Follow-ups: physical-phone feel pass (swipe threshold, D-pad reachability, snap-on-wall-turn hop, scroll/page-fit), browser rendering visual pass, accessibility backlogs. |
| D047 | Dynamic seeded maze generation adopted for the T2 prototype on 2026-11-10. Decisions: a pure, deterministic generator in `packages/shared/src/maze-gen.ts` (mulberry32 PRNG) produces reference-style dense, loop-rich, symmetric 21×19 mazes; fixed canvas with randomized interior; a random seed is chosen per game and displayed in the UI for reproducibility; the same API will let the authoritative server regenerate identical maps from a shared seed when T3 lands. Supersedes the fixed-single-maze part of D019 for the MVP; static `MAZE_MAP` remains the default/fallback and movement accepts an explicit maze. | Validation: `npm run check` green, 38 tests, including generator determinism, invariant (border/width/connectivity/no-2×2/loops) and spawn suites across many seeds. |
| D048 | Standing factory workflow gates, requested and confirmed by David (contract coordinator, D043) on 2026-11-10: (1) spec in `SPEC/` first, then delegate to the matching role agent; (2) `qa-tester` and `pr-reviewer` before any integration; (3) watch CI after a PR or user-approved merge and report final status. Details: [FACTORY.md](./FACTORY.md#standing-workflow-gates). | Working agreement so agents enforce the workflow without the user restating it each request. Refines D030; worktree isolation and human approval before integration are unchanged. Spec: `SPEC/factory-workflow-gates.md`. |
| D049 | T3 start flow and client scope, chosen by David on 2026-11-10: `chooseTeam` plus a host `startMatch` with balanced 1v1/2v2 teams goes directly to `playing`; T5 adds the 3-second countdown, contact, and round end. T3 ships a minimal working client UI; T4 polishes the mobile lobby and LAN docs. | Follows the approved contract's lobby flow without pulling T5 scope into T3. Spec: `SPEC/T3-private-rooms-and-synchronized-movement.md`. Its balanced-start and 2-per-team-cap portions are superseded by D054. |
| D050 | Review-cycle cap, requested and confirmed by David (contract coordinator, D043) on 2026-11-10: at most two review/fix cycles per unit; afterwards only blockers (failed acceptance criterion, crash/data integrity, security, regression) reopen work with one targeted fix re-checked alone, and other findings become PR follow-ups. CI failures are always fixed. Details: [FACTORY.md](./FACTORY.md#standing-workflow-gates). | Prevents endless review/fix loops observed during T3 while keeping blockers and green CI mandatory. Refines D048. |
| D051 | T4 (mobile lobby / local-network phone access) is implemented on the T3 client and mirrors the view in the URL hash: `#room=<code>` restores the room and auto-rejoins with the remembered display name; the join screen is the default. It adds `AppRoute`/`parseAppRoute`/`serializeAppRoute` to shared, persists the display name in `localStorage`, and documents the coordination model and firewall/network requirements. | Shipped 2026-11-10. Adopts T3's protocol constants as-is (no duplicates). Validation: `npm run check` green; QA smoke created and rejoined a real `GAME_ROOM` room via the hash round-trip. Physical-phone LAN pass remains pending. |
| D052 | Drop the pre-T3 offline "Enter prototype maze" fallback from the client, because T3's live private-room flow supersedes it. | T3 merged (PR #19); the standalone prototype demo is no longer needed and removing it avoids maintaining two lobbies. |
| D054 | Unbalanced lobbies: no per-team cap (a team is limited only by the room's 4-player cap); starting requires at least one hunter and one runner; unbalanced rosters (3v1, 2v1) are a warning only, not a block. The client shows a live Hunters/Runners counter and warns when the counts differ; `TEAMS_UNBALANCED` stays a contract-visible code but the server never emits it as a rejection. | Team confirmed no even-team requirement; the host may start any roster with ≥1 per team. Supersedes the balanced-start and 2-per-team-cap portion of D049/D023. Spec: `SPEC/unbalanced-lobbies.md`. |
| D055 | GitHub Issues is the factory tracker (scoping profile tracker: `github`, labels in `.github/labels.yml`, issue forms + PR template); `main` ruleset requires CI checks `Validate (Node 22.18.0)` and `Validate (Node 24.x)`; no required approvals. Requested and confirmed by David on 2026-11-10. Details: [FACTORY.md](./FACTORY.md#github-tracker). | Links units, specs, PRs, and CI; CI-only keeps a three-person team fast. Spec: `SPEC/github-tracker-integration.md`. |
| D057 | Label-driven GitHub agent pipeline ([SPEC](../SPEC/github-agent-pipeline.md)). Every new issue is triaged by `factory-orchestrator`, which picks the role agent(s); work starts only when a collaborator adds `agent:go`, and a human approves the spec with `/approve-spec`. Auto-merge is allowed only for `type:docs`, `type:chore`, and `follow-up` work, after required CI, Copilot code review, factory reviewer approval, and QA pass; `type:feature`, `type:bug`, and `playtest` work needs a human merge, and the strictest label wins. The pipeline acts only while repo variable `AGENT_PIPELINE_ENABLED` is `true`. | Requested and confirmed by David on 2026-11-10. Refines D048/D050 "human approval" for those low-risk types only; phone/LAN validation stays human. |

### Current combat summary

- Teammates pass through each other.
- A hunter is effectively invulnerable when the global vulnerability window is inactive
  **or** the hunter has an active shield.
- On opposing contact, an effectively invulnerable hunter eliminates an unshielded runner;
  an active runner shield prevents elimination and contact blocks instead (D015/D017).
- During global vulnerability, an unshielded hunter is eliminated by runner contact.
- Shields do not permit opposing players to pass through each other.
- No button attack, projectile, stun, or unconditional mutual-elimination rule is approved.

### Implementation follow-ups

- Assign implementation task owners. Specify remaining movement geometry,
  numeric validation limits, and disconnect batching details consistently with
  the approved [game contract](./GAME-CONTRACT.md).
- Local network access from phones; cloud provider/service/budget later, not a local-first blocker.
- Named mobile device/browser test matrix and measurable performance target.
- Deterministic contact/pickup resolution, including events at the round deadline.

## Checkpoint handoff

Product rules, stack, local-first direction, and collaboration agreements are
confirmed. David coordinates the shared contract and Chase reviews it.
T0 is complete: the team approved the [contract](./GAME-CONTRACT.md) in D044.
Browser/device validation and performance
targets remain explicit follow-ups, not approved claims of compatibility.

The approved baseline defines client intents, authoritative state, effect timestamps,
deterministic event ordering, visible errors, and acceptance tests.
T1 subsequently received go-ahead in D045; later tasks remain separate.

## T1 implementation context (not new gameplay decisions)

- npm workspaces: `apps/client` (Phaser/Vite), `apps/server` (Colyseus core and
  WebSocket transport), `packages/shared` (protocol/types/tuning).
- Root commands and LAN troubleshooting are in the [README](../README.md).
  `npm ci` installs the lockfile; `npm run dev` starts all three workspaces;
  `npm run check` runs typechecks, tests, and production builds.
- Native Node TypeScript execution avoids an extra development runner; require
  Node 22.18+ and npm 10+. Shared code compiles before client/server consume it.
- The diagnostic `connection-check` room is single-client and disposable. It
  proves protocol/state synchronization, not the four-player lobby or any round
  behavior. Client connection failures must be visible.
- Vite proxies same-origin `/multiplayer` HTTP/WebSocket requests to the loopback
  server. Phones reach the development machine on LAN port 5173; no cloud needed.
- Physical phone/browser compatibility, four-player gameplay, and teammate review
  remain unverified. Do not report the complete game contract as implemented.

### CI and artifact delivery: 2026-11-09

- Team requested basic GitHub Actions CI/CD. The workflow validates pull requests,
  main pushes, and manual runs using the root lockfile and `npm run check` on the
  minimum Node 22.18.0 and LTS Node 24.
- Main/manual Node 24 builds publish a seven-day downloadable build archive.
  This delivers compiled outputs and manifests, not a hosted game or an
  automatic cloud deployment. AWS/Azure selection remains deferred (D031).
- Required-merge checks must be enabled in repository rules separately. No cloud
  secrets, environment provisioning, or remote repository settings were changed.

### T1 validation and AI-workflow evidence: 2026-11-09

- Applied the TypeScript setup skill plus the installed Builder, QA Tester, and
  Docs Writer role guidance. An independent code-review agent followed the
  installed PR Reviewer guidance and reported no significant issues in the T1 diff.
  Agent review does not replace the required teammate review.
- On the available macOS Node 23.9.0/npm 10.9.2 environment, a clean `npm ci`
  and `npm run check` passed: seven tests, source/test typechecks, and all builds.
- Browser smoke check rendered a Phaser canvas and received a real authoritative
  snapshot through the Vite HTTP/WebSocket proxy. Portrait 390x844 and landscape
  844x390 viewport checks passed without horizontal overflow.
- A simulated failed matchmaking HTTP request produced a visible error and left
  retry enabled. These are diagnostic-room checks, not playable matchmaking tests.
- `npm start` launched the compiled server and `/health` returned protocol v1.
  Temporary validation servers were stopped after use.
- Nonblocking warning: Phaser's client bundle is about 1.54 MB minified / 411 KB
  gzip. Optimize/measure on target phones later; viewport emulation does not prove
  physical iOS/Android compatibility or frame-rate performance.

## T2 implementation context (not new gameplay decisions)

- T2 adds the first gameplay slice in the client: a rendered maze with
  touch and keyboard movement driven by a pure shared module (`movement.ts`)
  implementing approved D018/D040 semantics: continuous motion, buffered
  turns at legal turn points, wall/bounds blocking, and release does not
  stop movement.
- The maze is now generated per game by a seeded deterministic generator
  (D047). The original static map was 15×11; it was later enlarged to a
  21×19 static default/fallback (`MAZE_MAP`).
- Touch controls: on-screen D-pad (four buttons) and swipe/drag anywhere on
  the play area; keyboard arrows/WASD queue through the same path. Mobile
  anti-scroll uses `touch-action:none`, `preventDefault`, and overscroll
  suppression. Physical-phone feel is unverified.
- Server/synchronized movement (T3) is intentionally out of scope; no server
  files changed. The shared movement module is written to be reused by the
  authoritative server when T3 lands.
- Movement hardening (post-initial T2): blocked moves rest centered in the
  current corridor cell (no half-in-wall rest, no recenter hop), and queued
  turns are evaluated whenever a corridor center is reached (frame-alignment
  independent), so junctions are not skipped mid-run.

## T2 dynamic maze generation context (not new gameplay decisions)

- `packages/shared/src/maze-gen.ts` exports `generateMaze(seed)` (deterministic)
  and `findSpawnCell(maze)`. It builds horizontal runs on every odd row and
  mirrored vertical connectors on even columns, so every generated layout is
  connected, one-tile-wide, border-walled, loop-rich, and symmetric about the
  center column/row. Failed validation falls back to `MAZE_MAP`.
- The client generates a maze per game (`Math.random()`-derived uint seed) and
  shows `Maze seed <n>` in the UI; movement runs against that generated maze.
- The static `MAZE_MAP` (21×19) remains the default used by movement unit
  tests and by the generator fallback; `isInsideIn`/`isWalkableIn` operate on
  an explicit grid.
- Generator refinements (2026-11-10): an always-open perimeter ring and denser
  connectors make layouts loopier (turn options instead of dead ends), and a
  validated decoration pass adds tetromino-style L/J/T silhouettes to wall
  bars while preserving maze invariants.

## T3 implementation context (not new gameplay decisions)

Only D049 is a decision. The items below record implementation choices and
review-accepted deviations from the
[T3 spec](../SPEC/T3-private-rooms-and-synchronized-movement.md#implementation-deviations-accepted-after-review-2026-11-10);
tunables remain starting values for review.

- **Room code:** the opaque Colyseus `roomId` (contract §2 allows this
  initially). Game rooms are private (not listed for matchmaking).
- **Maze:** the server picks a uint32 maze seed per round and syncs it with the
  round ID; clients regenerate the maze with `generateMaze(seed)` (D047) and
  never choose the seed.
- **Start flow:** `chooseTeam` plus host `startMatch` goes directly to `playing`
  (D049; the balanced-start requirement is superseded by D054 — start now
  requires every player assigned and ≥1 per team, unbalanced rosters warn only).
  Players pass through each other, and a round runs until players leave; contact,
  countdown, and round end are T5.
- **Join closure without `lock()`:** Colyseus reports a locked room and a full
  room with the same error, so the room does not call `lock()`. It rejects
  non-lobby joins in `onAuth`/`onJoin` with `JOIN_CLOSED`; a started
  four-player room still reports `ROOM_FULL`. Do not add `lock()` later without keeping these codes distinguishable.
- **Malformed lobby requests:** `chooseTeam`/`startMatch` reply with a correlated
  `actionResult` (`INVALID_INPUT`) when a valid `requestId` is readable;
  otherwise with an uncorrelated `inputRejected`. Clients handle both and never
  leave a request pending.
- **Tunables** (`packages/shared/src/protocol.ts`): 30 Hz fixed-step simulation;
  ~20 Hz patches (50 ms; lobbies patch too); `setDirection` limit of 20 accepted
  inputs per second per client, with a client-side budget of 16 per second
  (`CLIENT_INPUT_BUDGET` in `apps/client/src/session-model.ts`);
  a hard cap of 60 messages per second per connection disconnects the offender;
  display names trimmed to 1-16 characters, rejecting control/format
  (`\p{Cc}\p{Cf}`) characters.
- **Spawns:** `findSpawnCells` places hunters near the top corners and runners
  near the bottom corners, preferring wall-adjacent cells so each player faces a
  wall and starts still until its first input.
- **No reconnect:** the client disables Colyseus SDK auto-reconnection; an
  unexpected disconnect shows a message and returns to the join screen.
- **Docs hook:** the pre-commit hook now sends its Copilot prompt on stdin
  instead of `-p` because Copilot CLI crashed on large argument prompts
  ([spec](../SPEC/docs-hook-stdin-prompt.md)). A follow-up fixed a variable
  scoping bug in the hook's response retry loop that broke Delivery Plan status
  updates.
- **Validation evidence:** shared validator/spawn tests, real-SDK server
  integration tests, and client session-model unit tests pass in `npm test`.
  A browser E2E run passed 28/28 checks, including 2v2, a server SIGKILL
  disconnect, and input spam. Not yet validated on physical phones (T4 exit
  gate); teammate review is pending.

## Local software factory and worktree isolation: 2026-11-09

- The team is establishing a local, agent-powered software factory (see
  `docs/FACTORY.md`). Role-specific subagents (builder, pr-reviewer,
  qa-tester, gameplay-designer, artist, docs-writer) are defined as project
  Herdr agents in `.pi/agents/`, overlaying bundled definitions and loading
  the matching `.github/skills/` role guidance.
- Distributed agents must not conflict. Each concurrent unit of work gets its
  own git worktree, created by `scripts/factory-worktree.sh`, on its own
  `factory/<unit>` branch, with a separate `npm ci` (no shared node_modules).
  Agents are instructed to operate only inside their assigned WORKTREE and to
  verify it with `git rev-parse --show-toplevel`. Read-only roles are scoped
  to the worktree and never write anywhere.
- Integration remains human-gated: after review and QA, integrate the
  `factory/<unit>` branch via PR (direct merge into `main` only with explicit
  user approval), record results, watch CI, and remove the worktree with
  `scripts/factory-worktree.sh remove <unit>` only after CI is green and the
  PR is merged (or the direct merge's `main` run is green). See D048.

## Maintaining this memory

- Add each confirmed decision with a stable ID, date, and a short reason.
- When changing a decision, mark it superseded and link its replacement; retain the history.
- Reconcile affected brief/spec/plan sections so future sessions do not find conflicting instructions.
- Keep unresolved questions explicit; never convert an assistant recommendation into a team decision.
- Before implementation, agree the shared game-state/message contract and acceptance checks.
- These files are local until committed and pushed through the team's normal review process.
  Do not assume other teammates have received an uncommitted update.

## T2-T4 completion verification

- D053 | Team manually verified T2, T3, and T4 complete on 2026-11-10. T2 (maze + touch movement, PR #10) passed the physical-phone check; T3 (private rooms + synchronized movement, PR #19) passed two-client LAN verification; T4 (mobile lobby / local-network phone access, PR #21) passed the LAN rejoin smoke and phone verification. Delivery-plan statuses for T2-T4 updated from "implemented; validation pending" to "Complete"; brief status block synced. | Recorded by the team after manual verification; remaining T5-T11 stay "not started".

## T4 implementation context (not new gameplay decisions)

- T4 merged onto the T3 client (after PR #19). The T3 flow is the single lobby:
  create/join by code, team pick, host start, and synchronized play. T4 adds
  the URL-hash view state and mobile/network documentation; the pre-T3 offline
  prototype-maze fallback is dropped (D052).
- Client (`apps/client/src/main.ts`): display name is persisted to
  `localStorage` on create/join; a successful room entry writes `#room=<code>`
  via `history.replaceState` (leaving clears it). On page load, a `#room=<code>`
  hash restores the code and display name and automatically attempts the join,
  so refreshing in a room drops the player back into it (join errors surface
  with the existing mapped messages).
- Shared (`packages/shared/src/index.ts`): `AppRoute` (`lobby` | `room`),
  `parseAppRoute`, `serializeAppRoute`, and `ROOM_CODE_MAX_LENGTH` with tests.
  The T3 `GAME_ROOM`/`parseDisplayName`/`errorMessage`/`joinErrorCode` protocol
  is used as-is; T4 adds no duplicate protocol constants.
- Validation: `npm run check` green (84 shared/server/protocol tests; 15
  docs/factory tests; builds). QA smoke re-created a real `GAME_ROOM` room,
  serialized `#room=<code>` from it, parsed it back, and rejoined the same room
  as a second client (phase `lobby`, matching code). Physical-phone LAN pass
  was completed and recorded in D053.

## T6 implementation context (not new gameplay decisions)

- D055 | Team marked T6 complete on 2026-11-10. The client match HUD, spectator
  mode, and results overlay were implemented in PR #27
  ([spec](../SPEC/T6-match-hud-spectate-results.md)), stacked on T5 (PR #26) and
  rebased onto main. Decisions: hybrid rendering (HTML panels for structured
  HUD/spectator/results content plus a Phaser countdown numeral); the maze phases
  (countdown/playing/results) route to the game view; result text is derived only
  from the server's `resultWinner`/`resultReason` when phase is `results` — the
  client never guesses a winner; spectator steering is gated via `canSteer`; the
  lobby render keeps the D054 unbalanced-roster behavior. | Recorded after an
  independent pr-reviewer approval (no blockers) and QA: `npm run check` green
  (128+16 tests), including 10 `hud-view` unit tests and 3 fast-clock integration
  tests driving the real room through countdown→playing→(elimination/timeout)→results.
  Follow-ups: live two-tab browser smoke, physical-phone matrix (T8/T9), T7
  pickups/vulnerability.

## D056 — Factory control center complete (M0–M4)

The factory control center shipped as a hybrid operator/team surface, in five
reviewed/QA'd milestones (each via PR + green CI):

- **M0** (`#38`): snapshot core — `factory-control/server` aggregates SPEC/git/
  Herdr/gh into one JSON snapshot with pure-inference stages, read-only API +
  CLI.
- **Hook fix** (`#39`): pre-commit docs hook restored `inception` provider and
  fails fast (drop `--no-extensions`; no silent Ollama fallback).
- **M1** (`#40`): read-only web mirror — Vite/React kanban, unit detail, agents
  panel, served by the control server; strictly read-only (405/404 contract).
- **M2** (`#41`): guarded actions API — prepare/execute protocol, snapshot-derived
  preconditions (409 + reasons), append-only audit log, per-unit locks, token
  gate.
- **M3** (`#42`): pi TUI extension — `/factory` screen (board/detail/actions/
  agents), keyboard-first, Herdr widget/pane focus untouched.
- **M4** (`#43`): skill & delegation triggers — dispatch queue
  (`/api/dispatch/*`), no-server-spawn guarantee (no `child_process`), TUI
  queue view + ready-to-paste delegation prompt.

Open follow-ups: M1 cross-device LAN check; M4 AC#7 manual Herdr-pane smoke;
snapshot cold-build latency (~38s `gh pr checks` fan-out); minor review nits
(F3/F5/F8 for M0; N1–N5 for M4).

## T7 implementation context (not new gameplay decisions)

- Implements [SPEC/T7](../SPEC/T7-three-pickups.md) against the approved
  D012/D019/D033–D042 contract: one authoritative pickup of each kind,
  independent speed/shield deadlines, global hunter vulnerability, safe seeded
  spawn/retry, collection refresh and the 0/8/18-second vulnerability schedule.
- Shared pure helpers retain true piecewise movement paths (including buffered
  corners and wall stops). Claims use path arrival time and a server-seeded,
  per-round stable shuffled player priority, not packet or map iteration order.
  Collection deadlines use the arrival's simulation time. Speed expiry within
  a step divides boosted/base-speed traversal; no speed strength stacking.
- Colyseus state publishes pickup cells/availability/respawn deadlines, player
  effect deadlines, global deadlines and the simulation cursor. Clients still
  send only existing direction/lobby requests. Combat uses one post-pickup
  snapshot, batches eliminations, blocks protected opposing contacts, and
  evaluates victory before timeout. Results stop simulation/spawning; replay
  clears pickup/effect state and reshuffles priority for the new round.
- Phaser shows distinct triangle/square/diamond pickup cues with text; HTML
  shows local speed/shield and global reversal seconds. Shielded and exposed
  hunters have explicit shape/text labels, not color-only indicators. These
  are authoritative-state displays, not client combat or winner predictions.
- Automated coverage includes shared timing/spawn/path/claim rules, real-room
  pickup/respawn/expiry/reversal/blocking/replay/deadline cases and client cue
  mapping, alongside existing T5/T6 regressions. Independent review and QA
  remain required before PR. No physical-phone, four-device, named browser,
  orientation or FPS acceptance is asserted here (T8/T9 remain open).
- Cycle 1 review fixes preserve D041's movement → pickups → contact-snapshot
  order: protected movement resolves chronologically through stop-created
  contact chains (each event freezes at least one new player, bounded by the
  roster). The blocker-only recheck corrects the former blanket next-phase
  exception: pickup candidates are processed in arrival order; a new shield
  blocks the remaining movement from acquisition, including later same-step
  contacts. Resolution preserves history through that arrival and rechecks
  remaining candidates on retained paths before committing further awards.
  Every combat contact still uses one common post-pickup effect snapshot.
  There is no rewind before a committed arrival, separation teleport or added
  knockback. This is implementation context, not a contract amendment.
  Regressions include the reviewer's four-player chain in all 24 iteration
  orders at normal/boosted speeds, real-room chain checks, and the exact
  6.25ms contact / 12.5ms shield-arrival example with a contested variant.
  The targeted recheck adds the 2.5ms shield acquisition / 13.75ms contact
  example: retained shield arrival, x=1.855/2.455 stops and 0.6 separation,
  including reversed iteration and real-room deadline assertions.
  Pickup arrival uses segment projection to avoid zero-radius discriminant
  roundoff on the QA-reported straight-crossing case.

## D058 — Ghost mascot dome arc drawn clockwise through the top (0, -radius)

The ghost mascot's body dome in `drawGhostBody()` (`apps/client/src/maze-scene.ts`)
is drawn with a clockwise arc (`anticlockwise: false`) from π to 0, which in
Phaser's downward-positive Y coordinates passes through `(0, -radius)` — the top
— so the dome caps the body and the eyes sit inside the colored body. This
resolves the PR #24 review blocker (issue #63); the previous anticlockwise arc
swept through `(0, +radius)` (the bottom), leaving a lower semicircle and the
eyes outside the body.
