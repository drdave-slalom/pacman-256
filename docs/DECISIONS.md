# Shared decision log

This is durable project memory for teammates and AI sessions. Read alongside the
[project brief](../PROJECT-BRIEF.md) and [delivery plan](../DELIVERY-PLAN.md).
Record confirmed decisions separately from proposals. No application implementation
is authorized by this checkpoint.

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
Implementation requires a separate go-ahead.

## Maintaining this memory

- Add each confirmed decision with a stable ID, date, and a short reason.
- When changing a decision, mark it superseded and link its replacement; retain the history.
- Reconcile affected brief/spec/plan sections so future sessions do not find conflicting instructions.
- Keep unresolved questions explicit; never convert an assistant recommendation into a team decision.
- Before implementation, agree the shared game-state/message contract and acceptance checks.
- These files are local until committed and pushed through the team's normal review process.
  Do not assume other teammates have received an uncommitted update.
