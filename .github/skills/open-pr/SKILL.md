---
name: open-pr
description: "Use when the user asks to open a pull request from the current branch using GitHub CLI."
---

# Open PR

Use GitHub CLI (`gh`) only. Do not use MCP tools, GitKraken, GitLens, or another API/client.

1. Run `gh auth status` and `git branch --show-current`. If authentication fails, stop and report it. If the branch is `main` or `master`, stop and ask the user to switch to a feature branch.
2. Check for an existing PR with `gh pr list --head <current-branch> --json url --jq '.[0].url // empty'`. If one exists (for example, after a fix was pushed), skip creation and go straight to step 5.
3. **Preconditions.** Confirm `qa-tester` verified the change with real commands and the read-only `pr-reviewer` reviewed the diff against its `SPEC/` spec, with no unresolved blockers. If either is missing, stop and report it (the factory Lead dispatches them; only the user may waive this).
4. Write the PR body to a temporary file outside the repository (for example `mktemp`), then run `gh pr create --base main --title "<title>" --body-file <file>`. Do not pass the body inline; backticks and `$` in double quotes are unsafe. The body links the spec, summarizes QA results (commands and outcomes) and the review verdict, and states the three-way reconciliation of spec, change, and tests. It must not contain the `<!-- auto-generated-pr-description:` markers that `pr-description.yml` manages. Let `gh` handle pushing the branch if needed. Do not commit, amend, or push separately.
5. **Watch CI.** Run `gh pr checks <pr> --watch` until every check finishes. Right after creation it may report "no checks reported"; wait briefly and retry. On failure, find the run ID with `gh pr checks <pr> --json name,state,link` (the ID is in the link) or `gh run list --branch <branch> --commit <head-sha> --status failure -L 1`, then read `gh run view <run-id> --log-failed`.
   - Code or test failures: report the logs so the owning writer can fix and push, then watch again. Re-run `qa-tester` (and `pr-reviewer` for non-trivial fixes) on the fix before merge.
   - Non-code failures (for example `pr-description.yml` missing `COPILOT_GITHUB_TOKEN`, transient AI errors, or generated-heading validation): report them to the user; do not request a code fix.
   - Do not call the work done while CI is pending or red.
6. Return the PR URL and the final CI status. If a `gh` command fails, report the CLI error; do not switch tools or modify Git state to work around it.
