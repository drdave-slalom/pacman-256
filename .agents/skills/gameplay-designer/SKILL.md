---
name: gameplay-designer
description: Design and balance game content for pacman-256 — maze layouts, ghost AI behavior, scoring, difficulty curves, power-ups, and game feel. Use when designing levels, mechanics, balancing, or tuning gameplay.
---

# Gameplay Designer

Design and tune the actual game experience of pacman-256: an original, mobile-first, **real-time multiplayer** maze-chase survival game. See `PROJECT-BRIEF.md` for the product direction.

## Product constraints (from the brief)

- **Original design** — original mazes, characters, and mechanics; **not** Pac-Man (no branding/characters/assets). Don't fall back on Pac-Man's exact designs.
- **Competitive survival rounds**: players compete in a shared maze until one remains; eliminated players spectate. Rounds are ~2–3 minutes, 2–4 players.
- **Power-ups** start with a **speed boost** and a **temporary shield** (their exact effects/duration/acquisition are open decisions to make).
- **Mobile-first & touch controls** — movement must feel good with touch input and adapt to orientation. This constrains complexity per control.

## Scope

- **Maze / level design** — layouts that work for multiple simultaneous players, create good flow, and keep chases tense but escapable. Must fit the touch/mobile experience.
- **Competitive balance** — fairness across players, catch-up/comeback moments, and readable player states.
- **Scoring & progression** — survival ranking, round-end results, and any scoring. Keep it simple enough for a 3-day MVP.
- **Power-ups** — the speed boost and shield: what they do, duration, how acquired, and how they interact with other players.
- **Game feel** — movement speed, input responsiveness, timings, pacing, and how elimination/spectating feel.

## Principles

- **Player-first**: a fair game lets a skilled player win through skill; deaths should feel earned, not arbitrary.
- **Mobile-first**: controls must be readable and usable on a touch screen; don't design around a keyboard/mouse.
- **MVP-focused**: one complete match is the success criterion. Defer scale (32 players) and breadth that don't support it.
- **Balance via data**: prefer tuning constants (speeds, times, scores) in config/data over hardcoding logic.

## Workflow

1. Read the current mechanics, the brief, and any design notes in the repo.
2. Propose or implement changes — maze data, power-up behavior, balance constants, etc.
3. Where possible, back decisions with reasoning about player experience (not just numbers) and the mobile/touch reality.
4. Flag trade-offs explicitly (e.g. fun vs. difficulty, simplicity vs. depth within the timebox).
5. Record consequential decisions as short notes in version control (per the brief's "shared source of truth").

Always consider how a change interacts with the engine and the Artist's assets (grid sizes must match tiles) and with the real-time server (what state is authoritative).
