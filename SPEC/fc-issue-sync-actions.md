# U4 spec: bidirectional GitHub write-back actions (comment / label / close-reopen)

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Depends on:** U1 shared schema (`result:fc-issue-sync-shared#1`), U2/U3 ingest (`result:fc-issue-sync-ingest#1` — units carry `issue: IssueCard`). · **Surface:** `factory-control/server/src/actions/actions.ts`, `preconditions.ts`, `types.ts` (+ `actions.test.ts`).

## Goal

Add guarded M2 write-back actions so the factory can act on GitHub issues through the same prepare/execute/lock/audit pipeline as every other action. The server never touches GitHub outside an executed, confirmed, guarded action.

## Scope (in)

Register three new `ActionDef`s in `buildDefs`:

1. **`github/issue-comment`** (mutates) — `gh issue comment <n> --body "<text>"`. Input: target unit (must carry `unit.issue.number`); comment text from the request body.
2. **`github/issue-label`** (mutates) — `gh issue edit <n> --add-label <a> --remove-label <r>` (omit flags not used). Input: add/remove label arrays.
3. **`github/issue-state`** (mutates) — `gh issue close <n>` or `gh issue reopen <n>` (state from input, default close).

Preconditions (in `preconditions.ts`, reuse existing guards/patterns):
- `unit-found` (target unit exists and has `issue`), `no-live-agent`, and a `gh-available` guard that fails when the snapshot's GitHub read is `unavailable` (or errors indicate gh missing) — reuse/extend existing pattern; never trust caller input for these facts.
- Mutating actions take the existing per-unit lock; `confirm: true` required; audit lines appended as today.
- Unknown action / invalid input keep existing `unknown-action` / `invalid-input` outcomes.

Tests (`actions.test.ts`): with an injectable mock runner, assert exact `gh` argv per action; assert denied/unguarded paths never invoke gh; assert unknown-action/invalid-input; assert lock + audit behavior consistent with existing actions.

## Out of scope

- Start-work action (U5), any UI wiring (U6/U7), changing existing actions, direct GitHub writes outside the action service.

## Acceptance criteria

1. The three actions exist in the registry with `mutates: true` (issue-comment/label/state), produce correct plans, and execute exactly the documented `gh` commands.
2. Guards deny without a unit carrying an issue, with a live agent, or when gh is unavailable; deny never runs gh.
3. Execute requires a prepared request + confirm; takes the per-unit lock; appends audit outcome; releases lock.
4. New tests pass; all existing action tests still pass; `npm run check` green.

## Validation

Inside the worktree: `npm test` (actions suite), `npm run typecheck`, `npm run build`, `npm run check`.

## Handoff

Builder reports: registry entries, guard list, exact gh argv per action, test results, lock/audit behavior, risks, three-way reconciliation.
