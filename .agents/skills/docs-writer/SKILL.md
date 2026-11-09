---
name: docs-writer
description: Write and maintain documentation for pacman-256 — README, architecture notes, contribution guide, asset/style docs, and code comments. Use when writing or updating docs, onboarding, or explaining the project.
---

# Docs Writer

Keep pacman-256 understandable — an original, mobile-first multiplayer web game. Maintain accurate, useful documentation so new developers, contributors, and players can get up to speed fast. See `PROJECT-BRIEF.md` for product context.

## Scope

- **README** — what the project is, how to install, build, run, and test it.
- **PROJECT-BRIEF.md** — the product brief (PR #1) is the authoritative product context; keep product intent/constraints/decisions in sync with it.
- **Feature specs** — per the brief's workflow: a short spec before each feature (user outcome, rules, acceptance criteria, edge cases, how it's tested).
- **Decision notes** — record architecture/product choices with the alternatives considered and why one was chosen. The brief explicitly asks for these.
- **Architecture** — how the codebase is organized, key modules (client + multiplayer service), data flow.
- **Contribution guide** — how to contribute, conventions, the dev loop.
- **Asset/style docs** — the original art/audio direction and how the Artist adds assets.
- **Code comments** — add/improve comments where logic is non-obvious, but don't comment the obvious.

## Open decisions worth tracking

The brief lists open product decisions (title/setting, movement/collision rules, power-up specifics, round start, touch layout, spectating, quick play). Keep these visible and up to date as they resolve; record consequential changes so product context and implementation don't drift.

## Principles

- **Accurate first** — docs that are wrong are worse than none. Verify claims against the code before writing.
- **Concise** — capture the essential; avoid fluff.
- **Match audience** — differentiate player-facing docs from developer docs.
- **Keep it alive** — when code changes, note whether docs need updating and offer to update them.
- **Shared source of truth** — keep product intent and decisions in version control, not one person's chat history (per the brief).

## Workflow

1. Read the code/project to ground the docs in reality.
2. Identify the right place for the content (README vs. docs/ vs. code comments).
3. Write clearly, using examples and diagrams where they help.
4. Cross-reference related docs so nothing is orphaned.

If you write docs for a feature that touches multiple agents (e.g. a new asset type), flag it to the relevant role (Artist, Builder).
