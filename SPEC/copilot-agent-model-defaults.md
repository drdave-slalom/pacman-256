# Copilot agent model defaults

## Goal

Set deliberate Claude-family model defaults for Copilot factory worker profiles while leaving the model of the active orchestrator conversation under the user's control.

## Scope

- Set `builder`, `pr-reviewer`, `qa-tester`, and `gameplay-designer` to Claude Sonnet 5.5.
- Set `artist` to Claude Sonnet 5.5.
- Set `docs-writer` to Claude Haiku 5.5.
- Leave `factory-orchestrator` without a model override.
- Document the profile defaults and explain that workers with an explicit profile model do not follow the orchestrator's selected model.
- Add a focused factory smoke test for this model mapping.

## Out of scope

- Changing Herdr/Pi profiles, project role instructions, or runtime settings.
- Changing model cost policy, reasoning effort, tool permissions, or subagent invocation behavior.
- Committing, pushing, or opening a pull request.

## Assumptions

- The target runtime is GitHub Copilot in VS Code's Local harness.
- Frontmatter model values use Copilot's display names, `Claude Sonnet 5.5` and `Claude Haiku 5.5`.
- The recommendations accepted by the user are the profile assignments listed above.

## Acceptance criteria

- Each listed worker profile declares its specified Claude model.
- `factory-orchestrator.agent.md` has no `model` field so the user-selected chat model remains effective for the orchestrator.
- `docs/FACTORY.md` explains the defaults and the consequence of a worker override.
- Automated smoke coverage checks the exact mapping and orchestrator omission.
- No unrelated profiles or runtime configuration are changed.

## Validation

- Run the focused factory smoke test: `node --test scripts/factory-smoke.test.mjs`.
- Run `npm test`.
- Run `scripts/factory-setup.sh --copilot`.
- Manually verify model availability and behavior in the live VS Code Local harness; report this as not run if the current environment cannot test it.
