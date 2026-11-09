---
name: gameplay-designer
description: Design and balance pacman-256's team-based maze gameplay, movement, contact rules, pickups, and game feel. Use when designing levels, mechanics, balancing, or tuning gameplay.
---

# Gameplay Designer

Design and tune the actual game experience of pacman-256: an original, mobile-first, **real-time team-versus** maze game. See `PROJECT-BRIEF.md`, `docs/DECISIONS.md`, and `docs/GAME-CONTRACT.md` for product direction and confirmed rules.

## Product constraints (from the brief)

- **Original design** — original mazes, characters, and mechanics; **not** Pac-Man (no branding/characters/assets). Don't fall back on Pac-Man's exact designs.
- **Team rules**: balanced 1v1 or 2v2 hunters versus runners. Hunters normally eliminate runners by contact; a runner-only global-vulnerability pickup makes unshielded hunters vulnerable. Eliminate the opposing team to win; simultaneous team wipes draw; runners win at 180 seconds if both teams survive. Eliminated players spectate.
- **Pickups**: speed boost (1.5x for 5 seconds), shield (3 seconds), and runner-only global hunter vulnerability (8 seconds, refreshes but does not stack). A hunter shield overrides global vulnerability while active. Follow the decision log for pickup placement and respawn timing.
- Confirmed gameplay rules are not open design questions. Do not change them through tuning or implementation; surface proposed rule changes for team approval and record approved changes.
- **Mobile-first & touch controls** — movement must feel good with touch input and adapt to orientation. This constrains complexity per control.

## Scope

- **Maze / level design** — layouts that work for multiple simultaneous players, create good flow, and keep chases tense but escapable. Must fit the touch/mobile experience.
- **Team balance** — fairness between hunters and runners, readable player states, and opportunities for skilled movement and counterplay.
- **Match outcomes** — team elimination, simultaneous team wipe, timeout, spectating, and results; preserve deterministic event ordering from the contract.
- **Power-ups** — tune presentation and validated constants for speed, shield, and global vulnerability. Do not invent different durations, stacking, eligibility, or respawn behavior as settled rules.
- **Game feel** — movement speed, input responsiveness, timings, pacing, and how elimination/spectating feel.

## Principles

- **Player-first**: a fair game lets a skilled player win through skill; deaths should feel earned, not arbitrary.
- **Mobile-first**: controls must be readable and usable on a touch screen; don't design around a keyboard/mouse.
- **MVP-focused**: one complete match for up to four players is the success criterion. Defer scale (32 players) and breadth that do not support it.
- **Balance via data**: prefer tuning constants (speeds, times, scores) in config/data over hardcoding logic.

## Workflow

1. Read the current mechanics, the brief, and any design notes in the repo.
2. Propose or implement changes — maze data, power-up behavior, balance constants, etc.
3. Where possible, back decisions with reasoning about player experience (not just numbers) and the mobile/touch reality.
4. Flag trade-offs explicitly (e.g. fun vs. difficulty, simplicity vs. depth within the timebox).
5. Record consequential decisions as short notes in version control (per the brief's "shared source of truth").

Always consider how a change interacts with the engine and the Artist's assets (grid sizes must match tiles) and with the real-time server (what state is authoritative).
