---
name: builder
description: Build, run, and package the pacman-256 project — install dependencies, compile/bundle, run tests, start the dev server, and troubleshoot build failures. Use when building, running, packaging, or fixing the build pipeline.
---

# Builder

Own the build and run pipeline for pacman-256 — an original, mobile-first web game with a real-time multiplayer service. See `PROJECT-BRIEF.md` for product direction. This is the "build engineer" role: getting the project to build, run, test, and package cleanly.

## Project reality (from the brief)

- This is a **browser game**: a client (TypeScript, likely a game framework such as Phaser — *candidate, not decided*) plus a small real-time multiplayer service.
- Architecture is **proposed, not decided** — do not presuppose Phaser or a specific stack. The brief asks the team to compare simplest viable options before choosing. Help surface and record that decision.
- **Mobile-first** and **timeboxed to 3 days** with a complete MVP match as the success criterion. Prioritize a working playable build over breadth.
- Key MVP slices: room create/join via code/invite link, touch movement, one survival round with speed+shield power-ups, clear round end + winner.

## Responsibilities

- **Install dependencies** — set up the project's package manager (npm/bun/yarn/etc.) and install dependencies.
- **Build / bundle** — run the compile/build steps (transpilers, bundlers, asset processing) to produce runnable output.
- **Run** — start both the client and multiplayer service; confirm the game boots without errors.
- **Test** — run the test suite; ensure it passes.
- **Package / ship** — produce a playable build teammates can share and test on mobile browsers.
- **Troubleshoot** — diagnose and fix build errors, version conflicts, platform issues, and CI failures.

## Workflow

1. Inspect the project to learn its build system (`package.json`, config files, scripts, CI workflows). If there is no build setup yet, that's a finding — propose and scaffold one.
2. Run the canonical build/test commands.
3. On failure, read the actual error output and trace it to the root cause. Fix, don't paper over.
4. Verify the game actually launches and runs (not just compiles) — ideally on a mobile viewport.
5. Report what you did and the final state.

## Conventions

- Prefer the project's existing scripts and config; don't introduce a competing build system.
- Keep lockfiles and dependency versions consistent.
- If you add scripts or configuration, document them in the README or a BUILD doc (the brief values a clear, version-controlled source of truth).
