# AGENTS.md

Project-wide agent instructions for **pacman-256**. This file follows the shared *Agent Instructions* standard, so it is honored by GitHub Copilot, ChatGPT, Claude, Cursor, and other tools, as well as pi.

## Project overview

- **pacman-256** is an **original, mobile-first, arcade-style maze-chase web game** with real-time competitive multiplayer. It is a workshop/demo project for a three-person AI-assisted team, timeboxed to three days.
- **Source of truth:** read `PROJECT-BRIEF.md` (PR #1) for the full product direction — concept, MVP outcome, open decisions, and the team's AI-first workflow. This file is project context, not an implementation plan.
- **Not Pac-Man:** the brief explicitly requires original naming, characters, mazes, art, and audio. Do **not** use Pac-Man branding, characters, or assets. The repo name and README (`"Clyde is watching"`) are working/inside-joke titles only — the shipped product must be original.
- **No 256-color palette mandate.** The "256" is just part of the repo name; the brief calls for *modern, stylized* art (2D with selective 3D depth/effects), not a constrained retro palette.
- **Key product facts:** mobile-first browser game; real-time team-versus play with balanced 1v1 or 2v2 hunters and runners; hunters normally eliminate runners by contact, while a runner-only pickup temporarily makes unshielded hunters vulnerable. The opposing team must be eliminated to win; simultaneous team wipes draw; runners win if both teams survive 180 seconds. Eliminated players spectate. The MVP supports up to four players; 32 is a possible later goal. Private rooms, touch-first controls, and three pickups (speed, shield, global hunter vulnerability) are in scope.
- **MVP success criterion:** one complete, demonstrable mobile-browser match: create/join a private room, move with touch controls, play a round with all three pickups, spectate after elimination, and see a clear result.
- **Agreed technical direction:** TypeScript/Phaser client, Node.js/Colyseus room server, and shared protocol/rules. The server owns gameplay truth and validates client intent. Validate locally and over the phone's local network before cloud deployment.
- **Confirmed rules:** consult [docs/DECISIONS.md](./docs/DECISIONS.md) and the approved [game contract](./docs/GAME-CONTRACT.md). They supersede older role examples: balanced hunter/runner teams, contact combat with vulnerability reversal, three pickups, and local-first development.
- The codebase is currently young; conventions below are the targets to converge on as code lands.

## Repository layout

- `PROJECT-BRIEF.md` — the product brief (PR #1). The authoritative product context.
- `.github/skills/` — project role and workflow skills (PR-reviewer, Artist, Builder, gameplay-designer, QA-tester, docs-writer, and scoping workflows).
- `apps/client/`, `apps/server/`, `packages/shared/` — npm workspaces for Phaser/Vite, Node/Colyseus, and shared protocol/rules respectively.
- `README.md` — real startup, validation, and local-network phone instructions.
- `AGENTS.md` — this file (shared standard).
- `.github/copilot-instructions.md` — GitHub Copilot-specific role instructions; role details are in `.github/skills/`.
- Per the brief: keep product intent/constraints/decisions in version control, write a short spec before each feature, and record architecture choices as decision notes. Assets live under `assets/` (sprites, tiles, audio) once created.

## Workflow & conventions

- **Run the exact commands** in the README / BUILD docs before assuming a change works. Build and test before declaring done.
- Root commands: `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`; `npm run check` combines validation. Require Node 22.18+ and npm 10+. T1 is a connection-check skeleton, not implemented gameplay.
- Keep the game buildable and testable. No dead code, no debug leftovers (`console.log`, TODO spam).
- Respect existing naming and structure. Prefer tuning game constants (speeds, timings, scores) in data/config over hardcoding.
- Game changes are player-first: a fair game lets a skilled player win through skill; deaths should feel earned.
- Never commit secrets, private participant info, or sensitive material into prompts or the repo.
- **AI-first workflow (from the brief):** clarify the problem and propose acceptance criteria *before* implementing; outline a small plan mapping to the spec; delegate only independent, well-bounded work; request focused tests with each behavior change; do a separate review pass for missed requirements, mobile usability, multiplayer edge cases, and regressions; report what changed, what was tested, and what remains uncertain. Treat AI output as a proposal — humans stay responsible.
- The brief's working role split (rotating, not silos): **Product/game experience** (rules, touch interaction, playtesting), **Multiplayer/platform** (room lifecycle, state flow, deployment), **Integration/quality** (shared contracts, e2e testing, keeping the build + context current).
- **Standing workflow gates (D048, apply without being asked):** for implementation work, write a spec in `SPEC/` and hand it to the matching role agent (the Lead does not implement; only research, read-only review, simple lookups, and small non-code edits stay direct; if subagents/roles are unavailable, stop and ask — only the user may waive); `qa-tester` and `pr-reviewer` must pass before any PR or merge (PR by default; direct merge only with user approval); after a PR or merge, watch CI with `gh pr checks <pr> --watch` (or the `main` CI run), fix failures via the owning writer, and report the final status. Cap review/fix at two cycles per unit; after that only blockers reopen work and other findings become PR follow-ups (D050). See [docs/FACTORY.md](./docs/FACTORY.md).
- **Tracker (D055):** GitHub Issues tracks factory units; PRs fill `.github/pull_request_template.md` and include `Closes #N` for the unit's issue. See [FACTORY.md](./docs/FACTORY.md#github-tracker).
- **Cloud pipeline (D056):** a label-driven GitHub pipeline (`agent:go`, `/approve-spec`) runs triage, spec, build, review, QA, and low-risk auto-merge with the Copilot cloud agent; the local flow stays supported. See [FACTORY.md](./docs/FACTORY.md#github-agent-pipeline-cloud-mode).

## Roles

This project uses the following roles. Their detailed skill definitions are in `.github/skills/`, with concise summaries in `.github/copilot-instructions.md`. When a task matches a role, follow that role's guidance.

| Role | When it applies |
| --- | --- |
| **PR-reviewer** | Reviewing diffs, pull requests, or proposed changes. |
| **Artist** | Creating/editing sprites, tiles, animations, UI, or audio. |
| **Builder** | Building, running, packaging, testing, or fixing the build pipeline. |
| **gameplay-designer** | Designing mazes, ghost AI, scoring, difficulty, or game feel. |
| **QA-tester** | Testing gameplay, writing/verifying tests, reproducing bugs. |
| **docs-writer** | Writing/updating README, architecture, or contribution docs. |
