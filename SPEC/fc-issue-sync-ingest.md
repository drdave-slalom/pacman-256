# U2/U3 spec: ingest GitHub issues into the factory-control snapshot (reader + linking + inference)

**Status:** Approved — delegated (combines reader + snapshot, one executor). · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Depends on:** U1 shared schema (result ref `result:fc-issue-sync-shared#1`; `IssueCard`, `IssueLabels`, `Unit.kind`, `Unit.issue`, `FactorySnapshot.issues`). · **Surface:** `factory-control/server/src/github.ts`, `snapshot.ts`, `infer.ts`, `markdown.ts`, `types.ts` (re-export already done in U1), tests.

## Goal

Read repository issues via `gh`, populate `FactorySnapshot.issues`, seed open-issue cards as units (kind `"issue"`), link them to SPEC units referenced via `Closes #N`, infer stage/attention for issue cards, and surface everything with the same defensive-read rules as the rest of the snapshot.

## Scope (in)

### U2 — reader (`github.ts`)
Add `readGitHubIssues(opts: { noGh: boolean }, runner = run): Promise<{ issues: IssueCard[]; unavailable: boolean; errors: string[] }>`:
- Command: `gh issue list --state all --limit 500 --json number,title,state,labels,assignees,milestone,createdAt,updatedAt,url,body`.
- Parse: labels → `IssueLabels` (`type:*`, `role:*` (array), `lane:*`, `status:*`, `blocked`, `follow-up`, `playtest`, `raw` = all names); assignees → login array; milestone → title string; body → `bodyExcerpt` (trimmed first ~200 chars).
- Defensive: `noGh` or gh failure → `{ issues: [], unavailable: true, errors: [..] }`; invalid JSON → `unavailable: false` + error entry; per-record parse failure → row retained with `state: "unknown"` + error entry; never throw. `errors` entries use the same style as `readGitHub` (e.g. `gh unavailable: …`).

### U3 — snapshot weaving (`snapshot.ts`, `infer.ts`, `markdown.ts`)
1. **Read issues** (call reader) and set `FactorySnapshot.issues = issues` (open + closed, raw).
2. **Seed open-issue cards:** for each open issue with no linked spec unit, create a unit `{ id: canonicalId("issue" + number), kind: "issue", issue: <card>, title, stage: inferred, flags: inferred, attention: inferred }` (open issues only; closed issues appear only in `issues`).
3. **Link via `Closes #N`/`#N`:** the markdown reader (`markdown.ts`) already extracts spec metadata — extend it to also collect referenced issue numbers (`#N`) from each spec file. PRs (`readGitHub` / `PullRequest`) link to units already; additionally collect issue numbers referenced in PR bodies (`Closes #N`) and match them to issues. When an issue number references matches an existing spec-derived unit, set that unit `kind: "hybrid"` and `unit.issue = <card>` (do not add a duplicate standalone card). If a referenced issue is closed, still attach it (history).
4. **Inference for issue cards (`infer.ts`):** derive stage from labels + artifacts, mirroring spec-unit rules:
   - `status:spec` → stage `spec`; `status:ready` → stage `spec` with flag `needsDispatch: true`; `status:in-progress` → `execute` (or `review` when a PR exists); `status:review` → `review`; no status → `spec` + `needsDispatch` when no artifact exists.
   - `blocked` label → attention `blocked-agent`? No — use existing attention vocabulary: append `"blocked-agent"` only when a live agent is blocked; for the `blocked` label use flag/attention `"parse-error"`—**do not invent new Attention strings**; keep to existing union. Use `needsDispatch` flag + `"needs-dispatch"` attention for actionable open issues with no branch.
   - A `factory/` branch/PR matching the issue card joins as usual (existing `bestMatch` machinery).
5. **Orphaned bucket unchanged** (unmatched issues are standalone cards, not orphaned).

## Out of scope

- Write-back actions (U4), start-work action (U5), web/TUI rendering (U6/U7).
- Changing existing unit inference for spec-only units (keep behavior identical for them).

## Acceptance criteria

1. `readGitHubIssues` returns typed `IssueCard[]`; `noGh`/gh failure → `unavailable` + errors; malformed records retained with `state: "unknown"`; never throws.
2. `FactorySnapshot.issues` holds all ingested issues (open + closed).
3. Every open issue appears as a card unit (kind `"issue"`) unless linked to an existing spec unit, in which case that unit is kind `"hybrid"` with `issue` attached, and no duplicate standalone card is added.
4. Issue cards have inferred `stage`, `flags`, `attention` per the rules above (existing Attention/Flag unions only) — no new enumerations.
5. New tests: reader parse (fields, label mapping, gh-less/unavailable, malformed row), markdown `#N` extraction, issue↔unit linking, hybrid vs standalone, inference cases. Existing tests still pass; `npm run check` green.

## Validation

Inside the worktree: targeted `npm test` suites (`factory-control/server/src/*.test.ts`, `actions/*`, `dispatch/*`), `npm run typecheck`, `npm run build`, `npm run check`. Reader unit exercises `gh` against the real repo (defensive fallbacks verified by disabling gh in tests).

## Handoff

Builder reports: files changed, gh field shapes observed, defensive-parse outcomes, link/inference rules implemented, test results, risks, three-way reconciliation.
