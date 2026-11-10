---
name: open-pr
description: "Use when the user asks to open a pull request from the current branch using GitHub CLI."
---

# Open PR

Use GitHub CLI (`gh`) only. Do not use MCP tools, GitKraken, GitLens, or another API/client.

1. Run `gh auth status` and `git branch --show-current`. If authentication fails, stop and report it. If the branch is `main` or `master`, stop and ask the user to switch to a feature branch.
2. Check for an existing PR with `gh pr list --head <current-branch> --json url --jq '.[0].url // empty'`. If one exists (for example, after a fix was pushed), skip creation and go straight to step 5.
3. **Preconditions.** Confirm `qa-tester` verified the change with real commands and the read-only `pr-reviewer` reviewed the diff against its `SPEC/` spec, with no unresolved blockers. If either is missing, stop and report it (the factory Lead dispatches them; only the user may waive this).
4. Write the PR body to a temporary file outside the repository (for example `mktemp`), starting from `.github/pull_request_template.md` and filling its sections: linked issue (`Closes #<n>` when the unit has an issue; otherwise "No issue"), spec link, QA results (commands and outcomes), review verdict, the three-way reconciliation of spec, change, and tests, and follow-ups (deferred findings, filed as `follow-up` issues, D050). Keep the template's empty `<!-- auto-generated-pr-description:start -->` / `<!-- auto-generated-pr-description:end -->` markers at the end, with nothing between them; `pr-description.yml` fills that block. Then run `gh pr create --base main --title "<title>" --body-file <file> --label "type:<kind>" --label "lane:<A|B|C>"`, choosing the `type:*` and `lane:*` labels from `.github/labels.yml` that match the unit (omit `lane:*` if none applies). If a label does not exist yet (check `gh label list`), drop that `--label` flag and report that `node scripts/sync-labels.mjs` needs to run. Do not pass the body inline; backticks and `$` in double quotes are unsafe. Let `gh` handle pushing the branch if needed. Do not commit, amend, or push separately.
5. **Watch CI.** Run `gh pr checks <pr> --watch` until every check finishes. Right after creation it may report "no checks reported"; wait briefly and retry. On failure, find the run ID with `gh pr checks <pr> --json name,state,link` (the ID is in the link) or `gh run list --branch <branch> --commit <head-sha> --status failure -L 1`, then read `gh run view <run-id> --log-failed`.
   - Code or test failures: report the logs so the owning writer can fix and push, then watch again. Re-run `qa-tester` (and `pr-reviewer` for non-trivial fixes) on the fix before merge.
   - Non-code failures (for example `pr-description.yml` missing `COPILOT_GITHUB_TOKEN`, transient AI errors, or generated-heading validation): report them to the user; do not request a code fix.
   - Do not call the work done while CI is pending or red.
6. Return the PR URL and the final CI status. If a `gh` command fails, report the CLI error; do not switch tools or modify Git state to work around it.
