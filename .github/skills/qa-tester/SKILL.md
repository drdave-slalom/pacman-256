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
4. Compete in one complete survival round, including the speed and shield power-ups.
5. See a clear round end and result, including the winner.

## Good test instincts (game-specific)

- Collision at exact boundaries (walls, power-ups, player/player overlap).
- **Multiplayer edge cases**: two players joining a room, room not full, disconnect/reconnect, stale state after elimination, and the round start (full vs. countdown).
- Power-up behavior: speed boost and shield duration, activation, and interaction with other players.
- Round lifecycle: start, survival/elimination, spectating, and results presentation.
- **Input handling**: touch taps/swipes, rapid input, held controls, device rotation mid-game.
- State transitions around death/elimination, respawn, and room exit.
- Performance: frame-rate stalls, memory growth over long sessions, and low-end mobile targets.

## Reporting

Report findings as: **bug**, **suggestion**, or **pass**. For bugs include: steps to reproduce, expected vs. actual, and severity (blocker / major / minor). Be precise and actionable.
