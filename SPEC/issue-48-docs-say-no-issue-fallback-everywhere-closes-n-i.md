# Issue #48: Document the “No issue” PR fallback

## Goal

Align the GitHub tracker guidance with D055 by documenting “No issue” when a PR has no linked issue.

## Scope

Update the two references in `docs/FACTORY.md` (GitHub tracker and dispatch example) and the tracker bullet in `AGENTS.md`. Make no other documentation or code changes.

## Out of scope

- Changes to the PR template, open-pr skill, or agent pipeline behavior.
- Application code, tests, or dependency changes.

## Assumptions

The existing PR template and open-pr skill are authoritative for the wording: `Closes #<n>` when an issue exists, otherwise “No issue.”

## Acceptance criteria

- Both identified `docs/FACTORY.md` references state the fallback.
- The `AGENTS.md` tracker bullet states the same fallback.
- No files beyond those two documentation files are changed by implementation.

## Validation

- `npm test`
- Review the diff to confirm only the three intended references changed.

## Delegation

- docs-writer: Update the three specified documentation references to include the “No issue” fallback.
- QA depth: fast
