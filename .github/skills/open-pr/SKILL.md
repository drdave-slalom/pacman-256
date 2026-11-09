---
name: open-pr
description: "Use when the user asks to open or create a pull request for the current branch."
---

# Open Pull Request

Prepare and create one pull request for the current branch using the repository's conventions.

## Workflow

1. Read the applicable `AGENTS.md` and repository instructions. Inspect the current branch, working tree, diff against its merge base, and recent commits. Preserve all user changes.
2. Check whether a pull request already exists for this branch. If it does, report its link and do not create a duplicate.
3. Search for a PR template in `.github/PULL_REQUEST_TEMPLATE.md` and `.github/PULL_REQUEST_TEMPLATE/`. If one exists, use its structure. Do not invent test results or claim checks passed unless you ran them.
4. Summarize the change accurately and identify relevant validation already completed. Do not include unrelated working-tree changes in the PR description.
5. If the branch is already pushed and the base branch is clear, create one PR using the available GitHub integration or authenticated `gh` CLI. Link the created PR and summarize its title and base branch.

Invoking this skill authorizes creating the PR when those conditions are met. It does not authorize staging, committing, or pushing changes. If the branch is not pushed, the base is ambiguous, required checks are unknown, or authentication is unavailable, stop and explain the blocker rather than guessing or changing Git state.