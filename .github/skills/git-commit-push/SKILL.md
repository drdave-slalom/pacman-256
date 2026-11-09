---
name: git-commit-push
description: "Use when the user asks to commit and push completed work, publish a branch, or create a safe task branch before committing."
---

# Commit and Push

Create a focused commit and push its task branch to the configured remote. The
user's request to use this skill authorizes committing and pushing the scoped
changes, but does not authorize including unrelated work, force-pushing, or
committing to a protected default branch.

## Workflow

1. Inspect the repository root, current branch, configured default branch when
   available, remotes, and working-tree status. Review staged and unstaged diffs
   before changing Git state. Never print remote URLs that may contain credentials.
2. Identify the files and changes belonging to this task. If staged or unstaged
   changes mix unrelated work, contain unclear user edits, or cannot be safely
   separated, ask which changes to include. Do not use `git add -A`, `git add .`,
   or destructive commands to sweep or discard changes.
3. If the current branch is `main`, `master`, or the configured default branch,
   create and switch to a new task branch before committing. Never commit on
   `main` or the configured default branch. Choose a prefix that matches the
   change: `feature/`, `bugfix/`, `docs/`, `refactor/`, `test/`, or `chore/`.
   Follow it with an optional known ticket ID and a short kebab-case description,
   for example `feature/T1-my-cool-new-feature` or `docs/update-setup-guide`.
   Never invent a ticket ID. Check for name collisions; choose a distinct
   description or ask rather than overwriting an existing branch.
4. Run relevant project-defined checks when practical. Inspect the final staged
   diff and run `git diff --cached --check`. Stage only the explicit, in-scope
   paths. Do not commit generated output, credentials, or unrelated files.
5. Create one commit with a concise, imperative, single-line message. Do not add
   a commit body or multiline trailer. Verify the commit is on the task branch
   and that its diff contains only the intended changes.
6. Push that branch to the configured remote and set its upstream when needed.
   Never push to `main` or the configured default branch. Never force-push,
   rewrite published history, change remotes, or bypass hooks. If the remote is
   missing, authentication fails, or the push is rejected, stop and report the
   exact blocker without trying a force push or changing repository settings.
7. Report the branch, one-line commit message, commit hash, remote push result,
   checks run, and any remaining uncommitted changes.

## Safety Rules

- Preserve pre-existing user changes; inspect before staging or switching branches.
- Do not amend existing commits or create empty commits unless the user explicitly
  requests that operation.
- Do not commit or push if the repository is in a merge, rebase, or cherry-pick
  operation; explain the state and ask how to proceed.
- If a hook modifies files, inspect those changes and re-check the staged diff
  before committing.
- If there is no configured remote, do not invent or configure one. Explain that
  a remote must be configured before this skill can complete the push.