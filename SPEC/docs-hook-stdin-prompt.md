# Spec: docs hook sends its Copilot prompt on stdin

**Status:** Approved by David (2026-11-10; "I want the docs hook to run") · **Type:** tooling fix

## Problem

`scripts/update-staged-docs.mjs` runs `copilot -p <prompt> -s --no-ask-user`. The prompt
embeds the staged diff plus README, DELIVERY-PLAN, DECISIONS, and GAME-CONTRACT
(about 60 KB of context before the diff). Copilot CLI 1.0.108/1.0.109 on macOS crashes
with a V8 fatal error (`Check failed: isolate_->IsOnCentralStack()`, exit 132/133,
spawnSync status `null`) when the `-p` argument exceeds roughly 50-80 KB. As a result
the hook blocks any medium-sized commit.

Reproduced: a `-p` prompt of 80-120 KB crashes; the same 120 KB prompt piped on stdin
(`copilot -s --no-ask-user < file`) returns normally with exit 0.

## Change

After PR #16 the hook selects a backend (`DOCS_LLM=copilot|pi`). This fix applies to the
Copilot backend (`runCopilot`) only; the Pi backend's invocation is unchanged.

- Pass the prompt via `spawnSync`'s `input` option (stdin) instead of `-p`. Keep `-s` and
  `--no-ask-user`, plus the sanitized env, timeout, and cwd. Raise `maxBuffer` only if needed.
- Factor the argument/option construction into an exported pure helper so the test
  can assert that no prompt text appears in argv and that the prompt goes to stdin.
- When the child is killed by a signal (`status === null`), include `copilot.signal` in
  the error message so it can be diagnosed.
- Leave the 45 KB diff cap, the secret scan, protected-doc rules, and the response
  validation unchanged.

## Acceptance criteria

1. The hook no longer places the prompt in argv; it is sent on stdin.
2. A unit test in `scripts/update-staged-docs.test.mjs` covers (1).
3. `npm test` passes.
4. Manual: in a worktree with ~27 KB of staged `packages/shared/src` changes, run
   `DOCS_LLM=copilot node scripts/update-staged-docs.mjs`. It completes without the V8 crash
   (it either stages doc updates or reports no changes).
