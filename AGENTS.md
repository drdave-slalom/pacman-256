# AGENTS.md

Project-wide agent instructions for **pacman-256**. This file follows the shared *Agent Instructions* standard, so it is honored by GitHub Copilot, ChatGPT, Claude, Cursor, and other tools, as well as pi.

## Project overview

- **pacman-256** is an **original, mobile-first, arcade-style maze-chase web game** with real-time competitive multiplayer. It is a workshop/demo project for a three-person AI-assisted team, timeboxed to three days.
- **Source of truth:** read `PROJECT-BRIEF.md` (PR #1) for the full product direction — concept, MVP outcome, open decisions, and the team's AI-first workflow. This file is project context, not an implementation plan.
- **Not Pac-Man:** the brief explicitly requires original naming, characters, mazes, art, and audio. Do **not** use Pac-Man branding, characters, or assets. The repo name and README (`"Clyde is watching"`) are working/inside-joke titles only — the shipped product must be original.
- **No 256-color palette mandate.** The "256" is just part of the repo name; the brief calls for *modern, stylized* art (2D with selective 3D depth/effects), not a constrained retro palette.
- **Key product facts:** mobile-first browser game; real-time versus play; short survival rounds (2–3 min) until one player remains, eliminated players spectate; up to 4 players first (32 is a later goal); private rooms via code/invite link; touch-first controls adapting to orientation; power-ups start with a speed boost and a temporary shield.
- **MVP success criterion:** one complete, demonstrable multiplayer match on mobile browsers (create/join room, touch movement, one survival round with speed+shield power-ups, clear round end + winner).
- The codebase is currently young; conventions below are the targets to converge on as code lands.

## Repository layout

- `PROJECT-BRIEF.md` — the product brief (PR #1). The authoritative product context.
- `.agents/skills/` — pi role skills (PR-reviewer, Artist, Builder, gameplay-designer, QA-tester, docs-writer).
- `AGENTS.md` — this file (shared standard).
- `.github/copilot-instructions.md` — GitHub Copilot-specific role instructions.
- Per the brief: keep product intent/constraints/decisions in version control, write a short spec before each feature, and record architecture choices as decision notes. Assets live under `assets/` (sprites, tiles, audio) once created.

## Workflow & conventions

- **Run the exact commands** in the README / BUILD docs before assuming a change works. Build and test before declaring done.
- Keep the game buildable and testable. No dead code, no debug leftovers (`console.log`, TODO spam).
- Respect existing naming and structure. Prefer tuning game constants (speeds, timings, scores) in data/config over hardcoding.
- Game changes are player-first: a fair game lets a skilled player win through skill; deaths should feel earned.
- Never commit secrets, private participant info, or sensitive material into prompts or the repo.
- **AI-first workflow (from the brief):** clarify the problem and propose acceptance criteria *before* implementing; outline a small plan mapping to the spec; delegate only independent, well-bounded work; request focused tests with each behavior change; do a separate review pass for missed requirements, mobile usability, multiplayer edge cases, and regressions; report what changed, what was tested, and what remains uncertain. Treat AI output as a proposal — humans stay responsible.
- The brief's working role split (rotating, not silos): **Product/game experience** (rules, touch interaction, playtesting), **Multiplayer/platform** (room lifecycle, state flow, deployment), **Integration/quality** (shared contracts, e2e testing, keeping the build + context current).

## Roles

This project uses the following roles. Each has a full definition in `.agents/skills/` (pi) and a condensed version in `.github/copilot-instructions.md`. When a task matches a role, follow that role's guidance.

| Role | When it applies |
|---|---|
| **PR-reviewer** | Reviewing diffs, pull requests, or proposed changes. |
| **Artist** | Creating/editing sprites, tiles, animations, UI, or audio. |
| **Builder** | Building, running, packaging, testing, or fixing the build pipeline. |
| **gameplay-designer** | Designing mazes, ghost AI, scoring, difficulty, or game feel. |
| **QA-tester** | Testing gameplay, writing/verifying tests, reproducing bugs. |
| **docs-writer** | Writing/updating README, architecture, or contribution docs. |
