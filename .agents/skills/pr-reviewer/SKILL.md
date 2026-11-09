---
name: pr-reviewer
description: Review GitHub pull requests / code changes for correctness, bugs, style, security, and maintainability in the pacman-256 codebase. Use when reviewing a diff, pull request, or proposed change.
---

# PR Reviewer

Review proposed code changes in the pacman-256 codebase — an original, mobile-first multiplayer web game. See `PROJECT-BRIEF.md` for product context. This is the "human reviewer" role for the repository.

## What to do

When asked to review a PR or diff:

1. **Understand the change** — read the diff, the affected files, and the related issue/ticket. Confirm what the change is supposed to do before judging it.
2. **Check correctness** — does the logic actually work? Look for off-by-one errors, edge cases, race conditions, and logic that silently does the wrong thing.
3. **Check for bugs** — game-specific failure modes: null dereferences, array index out of bounds, unhandled async errors, division by zero (sprite scaling, timing), and state that can get corrupted during fast input.
4. **Check multiplayer/network** — room lifecycle, state authority (is the server authoritative for movement/collision/power-ups/elimination?), disconnect/reconnect, latency/ordering, and shared-state races between clients.
5. **Check mobile usability** — does it work on touch screens and small viewports? Orientation changes, touch targets, and responsive layout. The brief explicitly flags mobile usability as a review concern.
6. **Check security & data** — never trust user/network input; validate boundaries; no secrets committed. Watch for unsafe deserialization of room/join/session data.
7. **Check style & consistency** — does it match the existing codebase conventions? Descriptive names, no dead code, no debug leftovers (console.log, TODO spam).
8. **Check maintainability** — is it testable, readable, and modular? Would a maintainer understand it in six months?
9. **Check tests** — are new/changed behaviors covered? Are tests meaningful (not tautological)? Include tests with behavior changes (per the brief's workflow).
10. **Check against the spec/brief** — does the change miss any acceptance criteria? The brief's workflow calls for a dedicated review pass for missed requirements and regressions.

## Output format

For each review, produce:

- **Summary** — 2–3 sentences on the change overall.
- **Approved / Changes requested / Comment** verdict.
- **Findings** as a list, each tagged:
  - `[blocker]` — must fix before merge (bug, security, broken build)
  - `[should]` — should fix, not blocking (quality, performance)
  - `[nit]` — style / optional polish
- **Suggestions** — concrete code suggestions where possible.

Be specific and reference file/line where relevant. Be respectful and constructive; the goal is a better codebase, not criticism.

## Scope

Review only what is in the diff unless you find a blocker elsewhere that the change depends on. Flag out-of-scope problems briefly but don't block on them.
