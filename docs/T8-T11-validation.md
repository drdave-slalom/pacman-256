# T8–T11 validation runbook and evidence template

**Preparation only.** This document is not acceptance evidence. All physical-device
checks, performance measurements, release-candidate matches and rehearsal below
are **NOT RUN**. Full T8 execution is **BLOCKED pending reviewed T7 and human
devices**. No browser compatibility or performance target is approved here.

Tracking: [T8 #31](https://github.com/drdave-slalom/pacman-256/issues/31),
[T9 #32](https://github.com/drdave-slalom/pacman-256/issues/32),
[T10 #33](https://github.com/drdave-slalom/pacman-256/issues/33),
[T11 #34](https://github.com/drdave-slalom/pacman-256/issues/34).
Dependency: [T7 #30](https://github.com/drdave-slalom/pacman-256/issues/30).

Sources: [preparation spec](../SPEC/T8-validation-preparation.md),
[delivery gates](../DELIVERY-PLAN.md), [README](../README.md),
[approved game contract](./GAME-CONTRACT.md), [decisions](./DECISIONS.md),
[local-network skill](../.github/skills/validate-local-network/SKILL.md).
Read current sources again before execution; do not infer that a concurrently
implemented feature is available on the served commit.

## 1. Evidence discipline and prerequisites

Keep these evidence categories separate:

| Category | What it establishes | Initial status |
|---|---|---|
| Preparation | Instructions/templates checked against repository text | Prepared; independent QA/review pending |
| Automated verification | Command result on a specific checkout | NOT RUN by this preparation unit |
| Physical tests | Observed behavior on named real devices | NOT RUN |
| Human review | Explicit review/approval of commit, matrix, target or defects | Pending; not granted by this document |
| Rehearsal | Actual live dry run and separately labeled backup | NOT RUN |

Use PASS only after observing the expected result. Use FAIL for an observed
mismatch, BLOCKED with the prerequisite/reason, or NOT RUN for unexecuted work.
Do not convert desktop emulation, automated tests or another commit's results
into a physical-phone pass. Preserve failed attempts and link retests separately.

Before the full pass:

- [ ] Confirm T7 is reviewed and integrated with T5/T6; record PR/review and CI
      evidence for the exact candidate. Missing pickups are a blocker, not a pass.
- [ ] Assign an operator, four players and an evidence recorder; obtain four
      physical devices. Agree the actual browser matrix and performance target.
- [ ] Reconcile rule questions against current decisions before testing. D054
      allows unbalanced teams if every player is assigned and both sides exist;
      use 2v2 for four-player acceptance, not as a new universal start restriction.
- [ ] Reserve a trusted reachable LAN and time for repeated rounds/retests.

Use aliases such as **Phone A**, not personal names, for device/player evidence.
Record model, OS and browser versions, but omit serial numbers, device IDs,
private participant details, Wi-Fi names/passwords, LAN addresses, active room
codes, tokens and raw sensitive logs from committed evidence. Keep operational
addresses local; redact captures before sharing. Link only approved artifacts.

## 2. Start and identify the candidate

Run from the intended source checkout root (not an extracted build artifact).
These are existing README commands; Git commands below record provenance and do
not create a new build identifier:

```bash
node --version
npm --version
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
npm ci
npm run check
npm run dev
```

Requirements: Node 22.18+ and npm 10+. `npm ci` installs dependencies and the
repository's local commit hook; follow existing setup policy. `npm run check`
runs `npm run typecheck`, `npm test`, then `npm run build`; capture actual exit
status and a sanitized output reference. A successful build is not gameplay or
phone validation. No commands were executed during preparation.

`npm run dev` builds/watches shared code, runs the backend and starts Vite at
port **5173** (strict port; stop the known conflicting stack if occupied). Vite
binds `0.0.0.0`; it proxies `/multiplayer` HTTP/WebSocket requests to
`127.0.0.1:2567`. The backend itself defaults to binding `0.0.0.0` (not
loopback-only); restrict testing to a trusted LAN and do not expose its port
publicly. The documented alternate is `PORT=2568 npm run dev`, which changes
backend and proxy together. Do not run two stacks in one checkout.
Keep the stack terminal open; Ctrl+C stops it after the session.

For this LAN runbook use `npm run dev`. `npm start` after building runs only the
compiled backend in the documented local setup; it is not a replacement for
serving `apps/client/dist`. Production/deployment setup is outside this runbook.

### LAN preflight (record desktop and phone results separately)

1. Put computer and phones on the same trusted reachable Wi-Fi. Find the host
   address in network settings or Vite's Network URL; keep the address local.
2. On the computer open `http://localhost:5173`, then
   `http://localhost:5173/multiplayer/health`. Expected health body:
   `{"status":"ok","protocolVersion":1}`. Use **Check server connection**;
   expected text: `Connected: shared protocol v1, authoritative lobby state received.`
3. On each phone open `http://<machine-LAN-IP>:5173`, then the same origin's
   `/multiplayer/health`; run the connection check and record page, HTTP and
   WebSocket outcomes separately. Phone `localhost` means the phone, not the host.
4. If unreachable, check the running stack, selected address and permitted OS
   inbound access to 5173. Guest-network isolation can block peers; use a permitted
   trusted network/hotspot. Do not disable firewalls, tunnel, forward router ports
   or expose the dev server publicly. Port 2567 need not be reachable by phones.
5. Plain HTTP may block clipboard access: manually share the displayed room code.
   Do not call HTTP testing validation of HTTPS-only browser features.

Freeze candidate source during a recorded run. Record full HEAD before and after,
working-tree status, startup time and serving mode. If HEAD/source changes or a
watch rebuild occurs, stop and label subsequent evidence a new candidate; rerun
checks. Clean Git status alone does not prove a browser loaded the right assets:
restart the intended stack, reload each browser and record that action. Do not
claim an in-app build identifier exists.

```text
Session/date/time zone: ____   Operator/recorder aliases: ____
Checkout root / branch: ____   Candidate full SHA: ____
Working-tree changes (including untracked) / reason: ____
Reviewed SHA / PR / human review / CI links: ____
Node/npm versions: ____   check exit/result/output reference: ____
Serving mode / stack start time / reload confirmation per device: ____
Desktop page / health / connection-check outcomes: NOT RUN — ____
Phone LAN preflight outcomes by alias: NOT RUN — ____
End SHA / status / stack stopped at: ____
```

## 3. Proposed physical-device matrix

At minimum propose iOS Safari and Android Chrome; actual coverage needs human
agreement. Other browsers are best-effort until agreed. Four desktop tabs do not
satisfy four-device acceptance. Fill all four device rows, including duplicates
of an OS/browser where that is the available hardware; disclose coverage gaps.

| Alias | Physical model | OS/version | Browser/version | Coverage proposal | Portrait / landscape | LAN / gameplay result |
|---|---|---|---|---|---|---|
| Phone A | ____ | iOS ____ | Safari ____ | Minimum proposed | NOT RUN / NOT RUN | NOT RUN |
| Phone B | ____ | Android ____ | Chrome ____ | Minimum proposed | NOT RUN / NOT RUN | NOT RUN |
| Phone C | ____ | ____ | ____ | Team to agree | NOT RUN / NOT RUN | NOT RUN |
| Phone D | ____ | ____ | ____ | Team to agree | NOT RUN / NOT RUN | NOT RUN |

Matrix approved by/date/scope: **Pending** — ____.
Unavailable devices/browser gaps and next owner/date: ____.

## 4. T8 — Four-player integration and failures

Execute each row as a separate recorded scenario. Use section 8 for observations,
not just checklist ticks. Restart/recreate a room when necessary. Spread pickup
and contact cases over multiple rounds so early elimination does not prevent
coverage. Do not modify production state or invent test buttons to force cases.

| ID | Steps and expected observation | Initial result |
|---|---|---|
| T8-01 | A creates a private room; B–D join via code. All four appear consistently; choose 2v2. Host starts; everyone sees 3-second countdown then synchronized movement and HUD. | NOT RUN |
| T8-02 | Navigate with D-pad and swipe, buffered turns and wall collisions; release touch while moving. Movement continues legally, teammates pass through, input remains usable without page scroll. Compare all four views. | NOT RUN |
| T8-03 | Collect speed and shield on both teams across rounds. Observe 1.5x speed for 5s and shield for 3s, visible acquisition/expiry on all clients, and speed/shield respawn 15s after collection. Observe overlap and refresh where feasible; link automated exact-timing coverage separately. | BLOCKED: reviewed T7 required |
| T8-04 | Hunter crosses vulnerability pickup without consuming it; runner collects it. Observe global vulnerability for 8s, hunter-shield override and expiry; next vulnerability pickup eligible 10s after global expiry (0/8/18s example). End round and replay: effects do not carry over. | BLOCKED: reviewed T7 required |
| T8-05 | Exercise each contact-table row across rounds: normal or shielded hunter vs unshielded runner eliminates runner; same hunter vs shielded runner eliminates neither and blocks contact; vulnerable unshielded hunter vs either runner shield state eliminates hunter. Verify all clients agree. Exact expiry/same-step boundaries require automated evidence, not guessed visual timing. | BLOCKED: reviewed T7 required |
| T8-06 | Eliminate one participant while a teammate survives. Eliminated player remains spectator, cannot steer, sees HUD and final server result. Host returns to lobby; connected teams remain, alive/effect/round state resets. Start another round without reload. | NOT RUN |
| T8-07 | Complete repeated four-player rounds, recording each round/result and reset. Verify hunter and runner elimination wins; deliberately survive to 180s for runner timeout. Attempt simultaneous wipe only if reproducible; otherwise mark manual case NOT RUN and link automated coverage, not a physical pass. | NOT RUN |
| T8-08 | From a spare browser context attempt malformed/unknown code; then join a four-player lobby (ROOM_FULL). In a separate started room with fewer than four participants, attempt join (JOIN_CLOSED). A started full room may report ROOM_FULL. Errors visible; retry/create remains usable. | NOT RUN |
| T8-09 | In lobby, host leaves: earliest remaining player becomes host. During countdown test a departure leaving a side empty (cancel to lobby) and a departure leaving both sides present (continue). Record separate attempts. | NOT RUN |
| T8-10 | During play disconnect a player, then separately the last player on one side: removal/remaining HUD agree and empty side loses. Disconnect host and verify new host can return from results. No automatic reconnect; dropped client returns to usable join screen with notice. | NOT RUN |
| T8-11 | All participants leave; attempt old code after disposal (record delay and response), then create a fresh room. Empty room must not remain joinable/stuck. Separately stop/restart the local stack: clients report disconnect, old in-memory room is gone, new room works. End-of-session disruption only. | NOT RUN |
| T8-12 | On every device rotate portrait↔landscape in lobby, play, spectating and results. D-pad/swipe, start/leave/back controls stay reachable; HUD/results readable; steering does not scroll page or trap controls under browser chrome. | NOT RUN |

For deterministic same-step wipes, deadline contacts, expired shields, stale-round
input and abuse guards, link actual automated results for the candidate; do not
simulate passing evidence with approximate human timing. If a manual setup is
not achievable, report NOT RUN/BLOCKED and seek reviewer disposition.

## 5. T9 — Mobile feel and restrained polish

After T8, repeat on the agreed matrix and both orientations:

- [ ] Check reachability with normal hand positions, turn responsiveness, no-scroll
      controls, viewport/browser chrome and safe areas; document missed inputs.
- [ ] Verify text, timer, alive counts, self/team identity, pickup/effect states,
      spectator status and result remain readable. Check non-color cues (labels,
      shapes/outlines or equivalent actual cues); record missing cues as findings,
      not assumed accessibility compliance.
- [ ] Inspect original visuals for occlusion/clutter during all three effects and
      elimination; do not add optional polish without an observed finding and
      team agreement. Repeat affected gameplay/performance checks after changes.
- [ ] Measure performance on each named device in active four-player play. Proposed
      minimum **>=30 FPS** remains unapproved until humans record agreement.

Measurement proposal: use available browser remote developer performance tooling
on a consenting device; capture a 60-second active-play sample including movement
and effects, and note tool/version, frame-count/time or tool FPS statistic,
minimum/typical FPS, stalls and sample conditions. If tooling cannot measure FPS,
record **NOT MEASURED**, with qualitative responsiveness separately; do not infer
FPS from server 30 Hz or display refresh. Document tethering/profiling overhead,
battery/thermal state, recording overhead and incomplete scene coverage. A short
sample is not a compatibility guarantee; remote debugging setup is device/tool
specific and is not an existing repository script.

```text
Device alias / SHA / date / orientation: ____
Tool + statistic definition / sample duration / scene: ____
Measured FPS + stalls / conditions / measurement limitations: NOT MEASURED — ____
Controls / readability / non-color cue findings and evidence: ____
Target approved by/date/value: Pending — ____
Actual matrix approval/reviewer and limitations accepted: Pending — ____
Observed defects / required retest / optional polish deferred: ____
```

## 6. T10 — Reliability and release candidate

Do not declare an RC from an automated green build alone.

- [ ] List each observed blocking defect, actual issue/reference if created,
      disposition, fix SHA, reviewer and retest evidence. Unresolved blockers keep
      the gate blocked; humans explicitly disposition other known limitations.
- [ ] Freeze and record the exact reviewed/served SHA using section 2; record
      automated checks, review and CI for that SHA. Any change creates a new
      candidate requiring relevant checks and a fresh consecutive-match sequence.
- [ ] Complete **three consecutive four-player matches** on the candidate with
      results, host return-to-lobby and successful next start. Record disconnects,
      stuck countdown/results/rooms and failures honestly; a failure breaks the
      sequence. Confirm room cleanup after the sequence and fresh create/join.

| Attempt / sequence position | SHA / date | Device aliases | Result / reset / next start | Stuck-room or cleanup observation | Defects / evidence |
|---|---|---|---|---|---|
| ____ / 1 | ____ | ____ | NOT RUN | NOT RUN | ____ |
| ____ / 2 | ____ | ____ | NOT RUN | NOT RUN | ____ |
| ____ / 3 | ____ | ____ | NOT RUN | NOT RUN | ____ |

Blocker disposition ledger: ____ (no issues or closures invented).
RC approval by/date/SHA and remaining limitations: **Pending** — ____.

## 7. T11 — Demo and workflow rehearsal

Proposed live script (assign speakers and timebox with the team):

1. State original game concept, candidate SHA and actual tested devices/limitations.
2. Show trusted-LAN startup already checked; create/join four phones by private
   code, choose 2v2 and start countdown.
3. Demonstrate touch movement and all three pickups, conditional elimination,
   spectating and clear server result. Use additional rounds if needed; never
   represent missed effects as demonstrated. Host returns to lobby for replay.
4. Show one genuine feature journey and what human review corrected. End with
   measured outcomes, known limits and next steps, not invented AI savings.

Fill the trace with real links; no fabricated PRs, test results or CI:

```text
Feature / issue: ____
Spec + acceptance section / plan: ____
AI-assisted change commit / PR: ____
Tests (file/case + actual execution evidence): ____
Independent review / human correction / retest: ____
CI run + exact SHA + outcome: ____
```

Each teammate supplies a genuine before/after example where they corrected or
reviewed AI output; sanitize excerpts and use teammate aliases in committed notes.
Do not invent an example to fill a row.

| Teammate alias | AI proposal + context | Human correction and why | Change/review link + validating evidence |
|---|---|---|---|
| ____ | Pending | ____ | ____ |
| ____ | Pending | ____ | ____ |
| ____ | Pending | ____ | ____ |

Dry-run record: date/speakers/duration/SHA/devices ____;
live steps actually shown ____; failures/recovery/retest ____;
reviewer and readiness decision **Pending** ____.

Backup recording: **NOT RECORDED**. When available, label it **BACKUP RECORDING —
not live**, with capture date, SHA, devices, demonstrated scope, known omissions
and approved storage link ____. Check playback during rehearsal. If live LAN
fails, state the failure and switch explicitly to backup; if none exists, disclose
that limitation. Rehearsal and backup do not replace T8–T10 acceptance.

## 8. Reusable scenario record and human handoff

Copy this block per scenario/attempt; blanks are intentionally not evidence:

```text
Gate / scenario ID / attempt: ____
Date/time zone / operator alias: ____
Candidate full SHA / reviewed SHA / serving mode: ____
Device aliases + browser versions / orientations: ____
Preconditions / steps / expected result: ____
Actual observation / timing or measurement method: ____
Outcome: NOT RUN [replace only with observed PASS / FAIL / BLOCKED + reason]
Sanitized evidence link: ____
Defect reference (only if real) / severity / next owner: ____
Fix SHA / retest record / human reviewer and disposition: ____
```

Human handoff (all pending until explicitly recorded):

- [ ] Independent qa-tester and pr-reviewer check this preparation document.
- [ ] T7 owner supplies reviewed implementation and candidate evidence.
- [ ] Humans supply four devices, approve matrix/target and execute LAN preflight.
- [ ] Record T8 scenarios, failures and retests; leave unavailable checks NOT RUN
      or BLOCKED with owner/next action.
- [ ] T9 owner records real measurements, cue/control findings and matrix approval.
- [ ] T10 owners resolve blockers and record frozen-SHA consecutive matches/cleanup.
- [ ] All three teammates provide genuine workflow corrections; run T11 live
      rehearsal and verify a clearly labeled backup if available.
- [ ] Human owners decide gate acceptance and update shared tracking separately.
      This preparation does not mark T8–T11 complete or authorize remote changes.

### Source cautions

At preparation time README describes T7 as later work and the delivery plan lists
T7–T11 as not started; another writer owns T7/status updates. README's statement
that two-phone validation has not happened conflicts with the delivery plan's T4
physical-phone completion statement. The brief/contract retain older balanced-team
and countdown-balance wording; D054 and current README clarify that an empty side,
not unequal non-empty teams, cancels countdown. These shared files were deliberately
not edited. Historical phone evidence is not four-device evidence for this candidate.
Recheck current sources and ask the contract coordinator about any unresolved
behavior contradiction before recording acceptance.
