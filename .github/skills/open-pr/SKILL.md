---
name: open-pr
description: "Use when the user asks to open a pull request from the current branch using GitHub CLI."
---

# Open PR

Use GitHub CLI (`gh`) only. Do not use MCP tools, GitKraken, GitLens, or another API/client.

1. Run `gh auth status` and `git branch --show-current`. If authentication fails, stop and report it. If the branch is `main` or `master`, stop and ask the user to switch to a feature branch.
2. Check for an existing PR with `gh pr list --head <current-branch> --json url --jq '.[0].url // empty'`. If one exists, return its URL and stop.
3. Otherwise run `gh pr create --base main --fill`. Let `gh` handle pushing the branch if needed. Do not commit, amend, or push separately.
4. Return the PR URL. If creation fails, report the CLI error; do not switch tools or modify Git state to work around it.
