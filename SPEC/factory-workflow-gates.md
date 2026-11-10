# Spec: factory workflow gates (spec → delegate → QA/review → PR → CI)

**Status:** Requested by David (2026-11-10) · **Type:** process/docs only

## Goal

Make the standing workflow automatic so the user does not repeat it each request:

1. **Spec first, then delegate.** For implementation work, the Lead writes one or
   more short specs in `SPEC/<task-id>-<slug>.md`. Each spec covers goal, scope,
   out-of-scope, assumptions, acceptance criteria, and validation. The Lead hands
   each spec to the matching role agent in its own worktree. The Lead does not
   make implementation edits for application behavior, tests, build config, or
   multi-file changes. Research, read-only review, simple lookups, and small
   non-code edits may stay direct. If subagents or the needed role are
   unavailable, stop and ask the user; only the user may waive this gate.
2. **Test and review before any PR.** The `qa-tester` verifies the change with real
   commands, and the read-only `pr-reviewer` reviews the diff against the spec.
   Both run before a PR is opened. Blockers are fixed by the owning writer and
   re-verified. The PR body summarizes the spec link, QA results, review verdict,
   and the three-way reconciliation of spec, change, and tests.
3. **After opening a PR, watch CI.** Run `gh pr checks <pr> --watch` (or poll until
   complete). On failure, read the logs (`gh run view --log-failed`), dispatch a fix
   to the owning writer, push, and watch again. Report the final CI status. Do not
   call the work done while CI is pending or red.

## Files

- `.github/skills/factory-orchestrator/SKILL.md` (canonical pipeline + final checks).
  Do not edit the `.agents/` mirror, and keep the frontmatter `description` unchanged.
- `.github/agents/factory-orchestrator.agent.md`
- `.github/skills/open-pr/SKILL.md`: preconditions (QA + review done), then CI watch.
- `docs/FACTORY.md` (pipeline section and dispatch example)
- `AGENTS.md`, `.github/copilot-instructions.md` (one concise bullet each)
- `docs/DECISIONS.md`: add a confirmed workflow decision (next free ID) attributed to
  David's 2026-11-10 request.

## Acceptance criteria

- All three gates appear consistently in each file above, with no contradictions.
- Existing guidance stays intact (worktrees, read-only reviewer, human approval).
- `npm test` passes, including `scripts/factory-smoke.test.mjs`.
- `scripts/factory-setup.sh --copilot` passes.
