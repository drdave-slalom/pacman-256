# Issue #53: Align cloud-pipeline guidance with gate behavior

## Goal

Correct the cloud-pipeline guidance in `docs/FACTORY.md` to match the current gate behavior.

## Scope

Update the cloud-pipeline step table and re-check notes in `docs/FACTORY.md` to reflect the acceptance criteria below.

## Assumptions

The issue's acceptance criteria describe the intended behavior; this unit documents existing gate behavior and does not change it.

## Acceptance criteria

- Step 2 says a PR with no active linked issue is ignored, not labeled `agent:needs-human`.
- It says `/approve-spec` during `[WIP]` receives a refusal comment rather than being ignored.
- Step 4 documents the QA comment's `Run:` line and that the gate binds verdicts to the latest relevant run.
- Re-check guidance says manual evaluate does nothing while `agent:needs-human` is set and explains rerunning review/QA with `gh run rerun <id>`.
- `npm test` passes.

## Validation

- Run `npm test`.
- Review the diff to confirm only the cloud-pipeline guidance in `docs/FACTORY.md` changes.

## Out of scope

- Changes to workflows, gate code, tests, or other documentation.
- Changes to pipeline behavior or issue/PR labels.

## Delegation

- docs-writer: Update the cloud-pipeline step table and re-check notes in `docs/FACTORY.md` to meet the acceptance criteria.
- QA depth: fast
