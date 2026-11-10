# Three-day delivery plan

**Status:** Draft for team agreement · **Date:** 2026-11-09
**Product source:** [Project brief](./PROJECT-BRIEF.md)
**Boundary:** Planning only. Checkpoint decisions are recorded in the
[shared decision log](./docs/DECISIONS.md); remaining proposals and estimates
are not approved decisions or completed work.

**Checkpoint update:** The team has selected team-based survival with direct
tagging/attacks, not individual last-survivor play against shared hazards.
Confirmed rules and unresolved details live in the decision log.

**Local-first update:** The team subsequently chose a working local server before
deployment and flexible lane contributions rather than fixed A/B/C ownership.
Use local-network phone access for initial integration gates; hosted-build and CI
work below is deferred until the local slice works. Cloud selection is not a T0
blocker. A/B/C denote work areas, not assigned people. Assign owners per task and
one owner for the shared contract. See D027-D032 in the decision log.

**Combat scope update:** D033-D036 confirm conditional contact combat: a third,
runner-only pickup makes hunters globally vulnerable; hunter shields temporarily
override it. Three pickups are now required.
Both teams can win by eliminating the opposition; runners win timeout, simultaneous
team wipes draw. D037/D038 set an 8-second vulnerability window and a
10-second respawn countdown beginning after that window ends.

## 1. Strategy: one playable vertical slice at a time

Deliver an original mobile-web survival game for up to four players: private room → touch-controlled multiplayer maze → elimination and spectating → winner/results. Include speed, shield, and runner-only vulnerability pickups. Target short 2–3 minute rounds.

**Critical path:** agree rules and contracts → connect two phones → complete a round → add power-ups → verify four-phone play → rehearse.

Do not build the client, server, and infrastructure in isolation until the final day. Keep a locally integrated build reachable from phones after the first checkpoint. Cut optional features before cutting integration, testing, or workflow evidence.

### Priority order

- **Must:** private rooms, responsive touch controls, a complete survival round, spectating/results, three pickups, and a visible spec-to-test/review trail.
- **Should:** invite links in addition to room codes, clear onboarding, replay without a page reload, and visual depth.
- **Stretch:** quick play, extra effects/audio, additional maps or power-ups.
- **Not in this workshop:** 32-player matches, accounts, persistent leaderboards, native packaging, full 3D production, or production-scale infrastructure.

## 2. First team checkpoint: resolve blockers in 45 minutes

T0 is complete: core rules, technology choices, and the
[shared contract](./docs/GAME-CONTRACT.md) are approved (D044).
Do not let three AI sessions invent different versions.

| Decision | Checkpoint outcome / remaining action | Work lane (not a fixed owner) |
|---|---|---|
| Combat | Hunters normally eliminate runners by contact; runner-only pickup reverses the outcome for vulnerable hunters. Shields override elimination as documented. | All |
| Round ending | Opposing-team elimination wins; simultaneous team wipe draws; runners win at 180 seconds if both sides survive. Resolve deadline collisions first. | All |
| Minimum players/start | Balanced 1v1/2v2; host starts a 3-second countdown; cancel on lost balance; no mid-round joins. | B + C |
| Disconnects | Remove disconnected players; empty side loses, both empty sides abandon; transfer lobby host; delete empty rooms. No seamless reconnect. | B |
| Pickups | Three pickups, server-timed. Use D012/D019/D033-D038 for effects, safe random placement, and respawn rules. | A + B |
| Touch input | Four-direction buffered turns approved. D-pad versus swipe remains a phone-prototype decision. | A |
| Stack | TypeScript + Phaser + Node.js/Colyseus with shared protocol/rules and server-authoritative gameplay. | All |
| Hosting | Local server and phone-network access first. AWS/Azure deferred. | C |

Pick a neutral original working title and placeholder shapes. Do not block on theme or art.

Record the approved rules and message/state contract before parallel implementation. Later changes require a short team heads-up and a spec update.

## 3. Ownership and capacity

Anyone may contribute to any lane. Assign ownership per task and for shared
contracts; rotate reviewers and who drives the AI session.

| Lane | Focus | Related responsibility |
|---|---|---|
| A | Game rendering, input, mobile UX | Review room/game integration |
| B | Multiplayer, authoritative rules, room lifecycle | Review deployment and failure handling |
| C | Local startup/networking, lobby/results UI, integration; deployment/CI later | Maintain the demo and workflow evidence |

**Scheduling assumption:** Day 1 is already underway. Use its remaining afternoon for the first slice; plan around workshop sessions rather than three uninterrupted coding days. Reserve approximately 25% of remaining capacity for integration, review, and surprises. Estimates below are focused hours for the assigned owner, not guarantees; shared review and integration use the reserve.

Work in 60–120 minute increments. At each checkpoint, merge reviewed work, run the shared build, and play it. If blocked for more than 30 minutes, pair or simplify rather than continuing speculative agent work.

## 4. Work chunks

Each chunk includes its tests, acceptance evidence, and a human-reviewed diff. Split any chunk that cannot produce a reviewable result within half a day.

| ID | Status | Chunk / owner | Estimate | Depends on | Acceptance checkpoint |
|---|---|---|---|---|---|
| T0 | Complete | Approve MVP rules, contracts, and scope / All | Completed checkpoint | — | Shared contract reviewed and approved; see D044. |
| T1 | Complete | Runnable skeleton and validation commands / C lane | 1–1.5 h | T0 | Root startup, typechecks/build/tests, shared imports, HTTP/WebSocket smoke check. See README; gameplay is not implemented. |
| T2 | Complete | One maze and touch movement / A | 2–3 h | T1 | A player can navigate on a real phone without scrolling the page or being trapped by controls; wall collisions work. The client prototype also adds keyboard input and seeded dynamic maze generation (D047). Manually verified complete (PR #10 + physical-phone check). |
| T3 | Complete | Private rooms and synchronized movement / B | 2–3 h | T1 | Two clients join one room and see each other move; invalid/full room errors are visible; server rejects invalid input. Manually verified complete (PR #19, two-client LAN). |
| T4 | Complete | Mobile lobby and local-network phone access / C lane | 2 h | T1 | Create/join UI reaches the local server from two phones on the same network; document startup, address and firewall/network requirements. Integrate with T3 when ready. Hosting/CI follow later. Manually verified complete (PR #21, LAN rejoin smoke). |
| T5 | Implemented; validation pending | Countdown, baseline contact elimination, and team round end / B lane | 3–4 h | T0, T3 | Authoritative rules complete a round; eliminated players cannot act; timeout, simultaneous team elimination, and disconnect outcomes have tests. T7 adds vulnerability reversal. Spec: [SPEC/T5](./SPEC/T5-countdown-contact-round-end.md). |
| T6 | Not started | Match HUD, spectating, and results / A | 2–3 h | T2, T3 | UI reflects server round state, time, alive players, elimination, and results; it never guesses the winner. Integrate with T5. Includes T5 results follow-ups (wording, screen-reader announcement, disconnect-win wording); see [SPEC/T5 follow-ups](./SPEC/T5-countdown-contact-round-end.md#follow-ups-open-after-t5-review-and-qa). |
| T7 | Not started | Three pickups and conditional contact combat / A + B lanes | Re-estimate before starting; original 1–2 h each covered only two effects | T5, T6 | Speed, shield, and runner-only vulnerability can be acquired and displayed; server controls effects. Tests cover vulnerability reversal, hunter shield override/expiry, runner protection, post-window respawn, and team victory. |
| T8 | Not started | Four-player integration and failure checks / C, all playtest | 2–3 h | T4, T5, T6, T7 | Four devices finish repeated rounds; invalid joins, room cleanup, disconnects, and orientation changes have recorded outcomes. |
| T9 | Not started | Mobile feel and restrained visual polish / A | 2 h | T8 | Agreed phone/browser matrix passes; controls stay usable; original visuals remain readable; optional depth effects do not hurt play. |
| T10 | Not started | Reliability fixes and release candidate / B + C lanes | 2 h each | T8 | Blocking defects closed; locally served build matches reviewed commit; three consecutive four-player matches complete. |
| T11 | Not started | Demo rehearsal and AI-workflow story / All | 1 h together | T9, T10 | Rehearsed local-network game demo plus one traceable feature journey: spec → plan → AI-assisted change → tests → review. Cloud hosting is optional after the local slice. |

T2, T3, and T4 run in parallel after T1. T5 and T6 can proceed in parallel against the approved contract. C starts test preparation while A and B implement gameplay. Do not wait for final polish to playtest.

## 5. Daily plan and exit gates

### Day 1 — Prove the riskiest path

1. **First 45 minutes:** T0; agree one-page rules, ownership, and shared contract.
2. **Next block:** C creates T1 while A and B refine input and room/state details without conflicting skeleton edits.
3. **Remaining afternoon:** parallel T2/T3/T4; prioritize the two-phone local-network connection over complete game mechanics.
4. **Exit gate:** two phones join a private room and see synchronized movement in one maze.

**If behind:** use placeholder shapes, one maze, and room codes only. If movement works on the development machine but not between two phones over the local network, everyone helps resolve that before more features are added.

### Day 2 — Make a complete game

1. **Morning:** B lane drives T5, A lane drives T6, C lane checks local-network access and writes/executes integration scenarios.
2. **Midday gate:** at least two players can start and finish a round with a visible result.
3. **Afternoon:** T7 and T8; integrate all three pickups, then play with four people.
4. **Exit gate:** four-player survival match completes on mobile, including conditional elimination, spectating/results, and all three pickups.

**If behind:** remove extra art, audio, replay convenience, and quick play from the schedule. Preserve the three pickups and core collision rules; seek team approval before cutting agreed mechanics. If the round still does not complete, Day 3 starts with repair, not new features.

### Day 3 — Stabilize and show the work

1. **Morning:** fix T8 findings, then T9/T10. Test on iOS Safari and Android Chrome using named devices.
2. **Midday:** feature freeze. Record the release-candidate commit and complete three consecutive four-player matches.
3. **Afternoon:** T11, workshop presentation, and contingency buffer. Preserve a short recording as backup, clearly distinguished from the live demo.
4. **Optional:** only attempt quick play after the freeze gate passes and the team agrees it cannot jeopardize the demo. Otherwise leave it as the next milestone.

**Exit gate:** demonstrable build, known limitations, repeatable test evidence, and a concise explanation of how all three people used and reviewed AI-assisted work.

## 6. Use the installed AE Toolkit deliberately

**Observed in this checkout:** initiative-scoping skills are installed under [.agents/skills](./.agents/skills/), including `scope-prd`, `scope-prd-to-spec`, and `scope-spec-to-tickets`. [Copilot instructions](./.github/copilot-instructions.md) now link the brief, decision log, and plan. Installation alone is not proof that skills are being discovered by every teammate's tool.

### Lightweight workflow for this timebox

1. **Align:** use the project brief and this plan as context. Approve T0 decisions before drafting implementation details.
2. **Specify:** write a short technical spec covering rules, state/messages, acceptance checks, and failure behavior. Avoid repeating the whole brief.
3. **Slice:** turn the approved spec into small tasks using the chunk IDs above. Each task names owner, dependencies, allowed surfaces, acceptance criteria, and validation.
4. **Implement and test:** one person owns each task. Give the assistant the relevant spec excerpt and code, not the entire toolkit or all prior chats.
5. **Review and integrate:** another person reviews intent and diff. Run tests and the local-network smoke check before calling the task complete.
6. **Hand off:** record changed behavior, validation results, limitations, and next step in the PR/task so a fresh AI session can continue.

If the team wants the formal toolkit pipeline, explicitly invoke `scope-prd` to formalize the brief, then `scope-prd-to-spec`, then `scope-spec-to-tickets` after approving the spec. Follow each skill's confirmation gates; do not generate every artifact merely to show toolkit usage. A short local task list is sufficient until the team chooses a tracker; publish nothing externally without approval.

### First tooling follow-ups

- Copilot is agreed; verify each teammate can discover the installed skills.
- Shared memory links are in the Copilot instructions. Add approved spec links and real validation commands when they exist; keep product detail in the documents.
- Branch/worktree conventions are agreed: one task per branch, separate working directories for concurrent agents, and no competing edits to shared contracts without coordination.
- Use a narrow reviewer/test agent where it adds value, not an uncontrolled tree of agents. Human approval remains mandatory.
- Rotate reviewer/driver roles and capture at least one concrete AI-assisted correction per person.

Verify tool discovery and add implementation-specific guidance when the team authorizes the next stage.

## 7. Definition of done and evidence

**For a task:** acceptance criteria demonstrated; focused tests and agreed build/type checks pass; another teammate reviews; shared context updated if behavior/contracts change; limitations explicit.

**For the demo:** verify the following, not just a successful build:

- Four players create/join a private room and finish a round; eliminated players only spectate.
- Speed, shield, vulnerability reversal, and pickup respawn behavior match the approved rules on all clients.
- Timeout, simultaneous elimination, and disconnection produce the documented result without a stuck room.
- On the selected iOS and Android phones, portrait/landscape controls remain reachable and the page does not scroll during play.
- Agree a frame-rate target during T0 (proposed minimum: 30 FPS on named test devices) and measure actual match performance.
- Repeat the release-candidate match three times; record device/browser, build commit, outcome, and defects.

Keep evidence concise: link tasks/specs to PRs, report real test results, and show one before/after example where human review improved AI output. Do not invent token savings or productivity metrics. Useful lightweight measures are completed playable outcomes, rework caught before merge, and time from approved spec to verified result.

## Next action

T0 is complete; the [game contract](./docs/GAME-CONTRACT.md) is approved (D044).
T1 is implemented (D045). T2 (one maze + touch movement, keyboard input, and
seeded dynamic maze generation) merged in PR #10 and passed the physical-phone
feel pass. T3 (private rooms and server-synchronized movement, D049) merged in
PR #19 and passed two-client LAN verification. T4 (mobile lobby / local-network
phone access) merged in PR #21 and passed the LAN rejoin smoke and phone
verification; it mirrors the view in the URL hash (`#room=<code>` reopens the
room with the saved display name), documents the coordination model and
firewall/network requirements, and drops the pre-T3 offline prototype fallback.
T2-T4 were manually verified complete on 2026-11-10 (D053). T5 (countdown,
baseline contact elimination, team round end) is implemented against
[SPEC/T5](./SPEC/T5-countdown-contact-round-end.md) and awaits PR review and
David's spec approval; its results/return UI is T6. T6-T11 remain not started. Run the
[README two-browser walkthrough](./README.md#two-browser-walkthrough) to review T3/T4.
David coordinates contract changes; Chase reviews.
Local-server validation precedes cloud work. Confirm actual test devices and
performance targets before acceptance.
