# T7 — Three authoritative pickups and conditional contact combat

Issue: https://github.com/drdave-slalom/pacman-256/issues/30
Owner: @clee231. Baseline: main at 53f9ad2; dependencies T5/T6 implemented.

## Goal and scope
Complete the approved pickup/combat slice across shared tuning/rules, Colyseus authoritative state/simulation, Phaser rendering, HTML HUD, and focused tests. Follow docs/GAME-CONTRACT.md §§3–6 and DECISIONS D012/D019/D033–D042. No new mechanics, dependencies, cloud deployment, branding, or optional art/audio.

## Assumptions and plan
Use existing server-owned seeded maze and simulation clock. Extend existing state rather than introduce client claims or a second protocol. Keep tuning in shared constants. One integrated writer owns this unit because movement, pickup awarding and contact snapshots are tightly coupled. Implement shared pure helpers/tests, server integration/tests, then readable client indicators/tests. Preserve existing input validation, lobby/replay and HUD behavior.

## Acceptance criteria
1. Start playing with exactly one speed, shield and vulnerability pickup on distinct reachable walkable cells, excluding player spawn and occupied cells. Use reproducible server-controlled randomization; retry next tick if no cell is valid. Do not spawn during lobby/results or carry effects into replay.
2. Both teams collect speed (1.5x, 5s) and shield (3s); only alive runners consume vulnerability (global 8s). Repeated same-kind effects refresh without stacking strength/duration, different effects coexist. Active iff simulation now < deadline, including exact expiry tests.
3. Speed/shield respawn 15s after collection; vulnerability 10s after global window ends (0→8→18s). Window refresh updates that schedule, independent of hunter shields. Never accept client pickup/effect declarations.
4. Claims use actual movement-path arrival time, exact ties resolved by stable server-seeded per-round player priority (not message/map insertion order). Do not miss fast crossings or corners; cover contested claims and hunter exclusion in deterministic tests.
5. Preserve approved order: expire effects → movement/walls → pickups → all contacts evaluated using one post-pickup snapshot → simultaneous eliminations → victory → timeout. Clamp deadline movement. Shielded opposing contact blocks, teammates pass through. New pickups affect same-step combat. Normally invulnerable/shielded hunters eliminate unshielded runners; runner shields block; globally vulnerable unshielded hunters die on runner contact regardless of runner shield. Hunter shield expiry exposes them for remaining global window.
6. Tests cover every contact row, exact effect boundaries, simultaneous mixed contacts/wipes, pickup-before-contact, speed traversal, global reversal victory, safe spawn/retry, claims/ties, refresh/respawn, end/reset, and relevant deadline behavior. Existing T5/T6 tests remain green.
7. All clients display active pickups with distinct original shape/text cues, local speed/shield remaining time, global vulnerability remaining time and visually distinguish shielded/vulnerable hunters; do not rely on color alone or guess combat/winners. Display uses authoritative state/time, no client gameplay authority. Preserve mobile controls and spectator gating.

## Validation and handoff
Run README commands: npm run typecheck, npm test, npm run build (npm run check combines them), plus focused tests. Add real-room integration coverage where feasible. Independent pr-reviewer and qa-tester must pass before PR; report exact commands/results, changed paths, architectural choices, limitations and human phone checks. T8 owns four physical devices and T9 named phone/browser/FPS acceptance: do not fabricate these here.

Escalate only contract conflicts, unavailable tooling, unsafe dependencies or required scope expansion. Resolve implementation details conservatively from the approved contract. Update delivery-plan/brief status and append an implementation-context note (not an invented approved decision) to docs/DECISIONS.md. Do not mark T7 human-accepted or T8 complete. Do not create/merge a PR or change remote issues; Lead owns those actions.
