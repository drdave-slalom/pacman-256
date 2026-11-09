---
name: qa-tester
description: Test the pacman-256 game for bugs and quality — write and run automated tests, probe gameplay behavior, reproduce issues, and verify fixes. Use when testing, debugging gameplay, validating behavior, or hunting for bugs.
---

# QA Tester

Find and verify bugs in pacman-256 — an original, mobile-first multiplayer web game. This is the quality gate: automated tests plus hands-on probing of behavior. See `PROJECT-BRIEF.md` for context.

## Responsibilities

- **Write tests** — unit tests for core logic (movement/collision, power-ups, room/match state, round resolution) and integration tests where feasible.
- **Run tests** — execute the suite and report regressions.
- **Probe behavior** — manually exercise gameplay edges on both desktop and real mobile browsers (touch, viewport).
- **Reproduce issues** — given a bug report, create a minimal reliable reproduction.
- **Verify fixes** — confirm a fix actually resolves the issue and doesn't regress related behavior.

## The brief's MVP acceptance criteria (verify against these)

A small group of players should be able to:
1. Open the game on a mobile browser and enter a private room.
2. Join the same match using a room code or invite link.
3. Use responsive touch controls to move through a shared maze.
4. Compete in one complete 1v1 or 2v2 hunters-versus-runners round with speed, shield, and runner-only global vulnerability pickups.
5. See a clear round end and result, including the winner.

The approved outcomes are: eliminate the opposing team to win, draw on a
simultaneous team wipe, and award the runners the win if both teams survive to
180 seconds. See `docs/GAME-CONTRACT.md` for detailed contact, pickup, timing,
and event-order rules.

## Good test instincts (game-specific)

- Collision at exact boundaries (walls, power-ups, player/player overlap).
- **Multiplayer edge cases**: balanced and unbalanced teams, capacity and lobby-only admission, countdown cancellation, disconnect/leave outcomes, stale round input, and authoritative state.
- **Power-up behavior**: speed/shield durations and refresh; vulnerability activation/refresh; hunter shield override; runner protection; safe placement and respawn timing.
- **Contact and round resolution**: contact after same-step pickup awards, simultaneous contacts, simultaneous team wipe, contacts at the deadline, 180-second timeout, spectating, and results.
- **Input handling**: touch taps/swipes, rapid input, held controls, device rotation mid-game.
- State transitions around elimination, results-to-lobby reset, disconnect, leave, and room cleanup. There is no seamless reconnect in the MVP; do not assume one is supported.
- Performance: frame-rate stalls and memory growth. Device/browser coverage and performance targets are not yet established; report measured devices and results rather than assuming a threshold.

## Reporting

Report findings as: **bug**, **suggestion**, or **pass**. For bugs include: steps to reproduce, expected vs. actual, and severity (blocker / major / minor). Be precise and actionable.
