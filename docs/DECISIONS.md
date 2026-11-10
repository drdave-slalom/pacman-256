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

- T2 adds the first gameplay slice in the client: the one shared maze (15×11,
  compact rectilinear corridors, original layout) rendered from
  `packages/shared/src/map.ts`, and touch movement driven by a pure shared
  module (`movement.ts`) implementing approved D018/D040 semantics: continuous
  motion, buffered turns at legal turn points, wall/bounds blocking, and
  release does not stop movement.
- Touch controls: on-screen D-pad (four buttons) and swipe/drag anywhere on the
  play area both queue directions through the same path. Mobile anti-scroll:
  `touch-action:none`, `preventDefault` on touchmove, `overscroll-behavior`,
  and user-select off. Physical-phone feel is unverified.
- Server/synchronized movement (T3) is intentionally out of scope; no server
  files changed. The shared movement module is written to be reused by the
  authoritative server when T3 lands.
- Reviewer note: reversal applies immediately anywhere (not gated to junctions);
  the contract lists buffered-reversal-between-junctions as still-open, so
  confirm it during T3. Snap-on-wall-turn shifts the actor half a tile when
  turning from a blocked wall boundary (intended; needs a device feel-check).

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

## Maintaining this memory

- Add each confirmed decision with a stable ID, date, and a short reason.
- When changing a decision, mark it superseded and link its replacement; retain the history.
- Reconcile affected brief/spec/plan sections so future sessions do not find conflicting instructions.
- Keep unresolved questions explicit; never convert an assistant recommendation into a team decision.
- Before implementation, agree the shared game-state/message contract and acceptance checks.
- These files are local until committed and pushed through the team's normal review process.
  Do not assume other teammates have received an uncommitted update.
