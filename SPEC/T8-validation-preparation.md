# T8 — Prepare four-device validation and downstream evidence

Issue: https://github.com/drdave-slalom/pacman-256/issues/31
Owner: @clee231. This is preparation only; T8 acceptance depends on reviewed T7 and human devices.

## Goal / scope
Produce a concise executable playtest/runbook and honest evidence template for the remaining delivery gates T8–T11. Allowed changes: this spec and new docs/T8-T11-validation.md only. Do not edit README, DELIVERY-PLAN, PROJECT-BRIEF, DECISIONS, application code or tests (another unit owns shared status updates). Read DELIVERY-PLAN.md, README.md, docs/GAME-CONTRACT.md and existing validate-local-network skill if available. Follow docs-writer skill.

## Acceptance
- Link #31, #32, #33, #34, #30 and source contract/README; distinguish preparation, automated verification, physical tests, human review and rehearsal. Never mark unexecuted scenarios pass.
- Give exact existing local-startup and validation commands, commit/build identification and LAN checks without inventing scripts or assuming phone localhost means the server. Keep secret/network/device personal data out of committed evidence.
- Provide a fillable named-device/browser matrix (iOS Safari and Android Chrome minimum proposed coverage; remaining browsers best-effort until team agreement). Performance target remains proposed >=30 FPS until humans approve; document measurement method/limitations rather than asserting compatibility.
- T8 scenario checklist: four players private room, all three effects, conditional elimination, spectator/results/replay, repeated rounds, invalid/full/closed joins, disconnect/host transfer/cleanup, orientation and no-scroll controls. Record commit, date, scenario, devices, outcome, defects. No fictional defect issues.
- T9: portrait/landscape reachability, readable non-color cues, visual clarity, measured performance and approval of actual matrix. Defer optional polish absent observed findings.
- T10: blocking defect disposition, exact reviewed/served commit, three consecutive four-player matches and no stuck rooms; evidence blanks, not invented passes.
- T11: demo script, feature journey links issue→spec→change→tests→review→CI, per-teammate genuine AI-assisted correction, labeled backup recording and dry-run evidence. Do not fabricate metrics or recordings.
- Explicit human handoff checklist and blocked/not-run status for unavailable devices/rehearsal. No new product rules or approved decisions.

## Validation / handoff
Check linked local paths and commands against repository. Report paths inspected/changed, verification actually performed and unresolved gates. No npm ci needed for docs writing. Independent pr-reviewer and qa-tester will verify before PR. Commit on factory/t8-validation-prep respecting hooks; no push/PR/issue modifications or merge. Escalate unavailable source instructions or material contradictions; otherwise choose conservative defaults and label proposals.
