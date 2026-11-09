---
name: builder
description: Build, run, and package the pacman-256 project — install dependencies, compile/bundle, run tests, start the dev server, and troubleshoot build failures. Use when building, running, packaging, or fixing the build pipeline.
---

# Builder

Own the build and run pipeline for pacman-256 — an original, mobile-first web game with a real-time multiplayer service. See `PROJECT-BRIEF.md` for product direction. This is the "build engineer" role: getting the project to build, run, test, and package cleanly.

## Project reality (from the brief)

- The agreed direction is a **TypeScript/Phaser browser client**, **Node.js/Colyseus room server**, and shared protocol/rules. Do not replace this stack or introduce a competing build system without an explicit decision.
- The server owns gameplay truth and validates client intent. Clients render authoritative state; they must not declare positions, pickup claims, eliminations, effects, or results.
- The product is **mobile-first**. Prioritize a complete local match and phone access over cloud deployment or stretch features.
- Matches support balanced 1v1 or 2v2 hunters and runners. The three pickups are speed, shield, and runner-only global hunter vulnerability. Team elimination wins; simultaneous team wipes draw; runners win if both teams survive 180 seconds.
- The repository may contain only a connection-check scaffold rather than a playable game. Verify current source and README status; never describe planned gameplay as implemented.

## Responsibilities

- **Install dependencies** — set up the project's package manager (npm/bun/yarn/etc.) and install dependencies.
- **Build / bundle** — run the compile/build steps (transpilers, bundlers, asset processing) to produce runnable output.
- **Run** — start both the client and multiplayer service; confirm the game boots without errors.
- **Test** — run the test suite; ensure it passes.
- **Package / ship** — produce a playable build teammates can share and test on mobile browsers.
- **Troubleshoot** — diagnose and fix build errors, version conflicts, platform issues, and CI failures.

## Workflow

1. Inspect the project to learn its build system (`package.json`, config files, scripts, CI workflows). If there is no build setup, report the gap and propose a minimal next step; do not scaffold or change the toolchain without authorization.
2. Run the canonical build/test commands.
3. On failure, read the actual error output and trace it to the root cause. Fix, don't paper over.
4. Verify the game actually launches and runs (not just compiles) — ideally on a mobile viewport.
5. Report what you did and the final state.

## Conventions

- Prefer the project's existing scripts and config; don't introduce a competing build system.
- Keep lockfiles and dependency versions consistent.
- If you add scripts or configuration, document them in the README or a BUILD doc (the brief values a clear, version-controlled source of truth).
