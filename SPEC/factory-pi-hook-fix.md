# Factory spec: pre-commit docs hook pi fallback fix

**Status:** Draft — for builder execution. · **Root cause:** investigation
`result:precommit-pi-diag#1` (hook passes `--no-extensions` → `inception`
provider disabled → primary `pi` spawn fails instantly with `Unknown provider
"inception"`; fallback silently runs on local Ollama, CPU-bound, exceeding the
240 s `spawnSync` timeout → `ETIMEDOUT` stops commits from inside pi sessions).

## Goal

Make the repository pre-commit docs hook (`scripts/update-staged-docs.mjs`,
installed via `.githooks/pre-commit`) complete successfully when committing
implementation/config changes from inside a pi session — without hanging and
without silently falling back to a slow local model.

## Scope (in)

- In `runPiAgent()` in `scripts/update-staged-docs.mjs`, drop `--no-extensions`
  from the `pi` invocation (restores the `inception` provider so the requested
  `--provider`/`--model` works). Keep `--no-tools --no-session
  --no-context-files --no-mcp --no-skills`.
- Optionally: on primary spawn failure for an explicitly requested
  `--provider`/`--model`, fail fast with a clear message instead of retrying on
  an unknown provider path (or pre-check `pi --list-models`), so the fallback
  never silently runs on Ollama.
- Add/adjust script tests in `scripts/update-staged-docs.test.mjs` for the
  changed behavior.

## Out of scope

- Harness-side/upstream provider-extension changes (pi version bump).
- Editing `~/.pi/agent/models.json` or other user config.
- Game/client/server code; Copilot backend; anything outside this script and
  its tests.

## Acceptance criteria

1. A `git commit` with staged implementation/config changes, run from inside a
   pi session (non-TTY hook env), completes without `ETIMEDOUT`; the docs hook
   succeeds or reports a deterministic skip.
2. `node scripts/update-staged-docs.mjs` in a pi-like env exits 0 within a
   reasonable bound (responsive server) and does not hang past the timeout.
3. When no documentation-relevant implementation/config changes are staged, the
   hook still skips with the existing "No documentation-relevant …" message.
4. Positive control: `pi -p <prompt> --provider inception --model mercury-3`
   **without** `--no-extensions` exits 0 quickly (provider restored).
5. `npm test` (incl. `scripts/update-staged-docs.test.mjs`) and `npm run
   check` pass.

## Validation

Inside the worktree: run the original failing repro (with `--no-extensions`)
and the fixed invocation; run `npm test`, `npm run typecheck`, `npm run
build`, `npm run check`; make a real `git commit` inside the worktree with an
implementation change staged under a pi-like env and confirm the hook passes.

## Handoff

Builder reports: files changed, before/after repro outputs, test results,
behavior notes (fallback handling), risks, and the three-way reconciliation.
