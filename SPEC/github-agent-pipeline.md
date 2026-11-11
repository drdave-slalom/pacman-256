# Spec: label-driven agent pipeline on GitHub (issue → spec → build → review/QA → merge)

**Status:** Approved by David (2026-11-10); Phase 0 pilot in progress · **Type:** process/CI config · **Depends on:** PR #35 (D055)

## Goal

Run the factory SDLC on GitHub without a VS Code session. A human labels an issue,
role agents do spec, build, review, and QA, and low-risk work merges itself.
Humans keep two gates: spec approval and (for features/playtest work) merge.

## Architecture (confirmed by David)

- **Orchestrator is the single entry point (David, 2026-11-10).** Every new issue is
  triaged by `factory-orchestrator`, and every unit's spec names the role agent(s)
  that do the work. Humans do not pick the build agent; `role:*` labels mirror the
  orchestrator's decision. After `/approve-spec` the gate posts one `@copilot` comment telling
  Copilot to work through the Delegation steps in order, acting as (or delegating to)
  each named `.github/agents` profile. Per-step re-assignment was not built because
  re-assigning an issue opens a new PR.
- **Build (writer):** Copilot cloud agent, assigned through the issues API with
  `agent_assignment.custom_agent` set to the profile the orchestrator chose.
- **Review/QA (independent, read-only):** GitHub Agentic Workflows (`gh aw`),
  engine `copilot`, writes only through safe outputs.
- **Glue:** plain Actions workflows driven by labels and comments.
- **Auth:** personal repo, so a user PAT secret `COPILOT_ASSIGN_TOKEN`
  (created by David; never committed or echoed) for Copilot assignment;
  existing `COPILOT_GITHUB_TOKEN` for gh-aw/CLI.

## Flow and label state machine

| Step | Trigger | Actor | Result |
|---|---|---|---|
| 0. Triage | Issue `opened` / `reopened` by a triage+ collaborator (any template; others are not triaged, to protect the premium-request budget on this public repo) | `factory-triage.md` (gh-aw, orchestrator profile, read-only) | Classifies type, lane, and the role agent(s) needed; checks readiness (AC, validation, duplicates, conflicts with `docs/DECISIONS.md`); suggests a split into sub-issues when one unit spans roles that can't share a PR. Safe outputs: `type:*`/`lane:*`/`role:*` labels and one triage comment with the plan and any gaps. Labels `status:spec` (ready) or `agent:needs-human` (gaps/rule questions). Never starts work. |
| 1. Queue | Human adds `agent:go` to an issue | `agent-dispatch.yml` | Verifies labeler has triage+, the issue is open, not assigned to Copilot, and lacks `agent:active`/`agent:needs-human` (triage is not required; label untriaged issues by hand first); max `AGENT_MAX_ACTIVE` (default 3) active; assigns Copilot with `custom_agent: factory-orchestrator` and instructions "spec only: write `SPEC/<id>-<slug>.md` including a **Delegation** section (ordered role agent per step, QA depth fast/slow), open a draft PR with `Closes #N`, stop". Labels: `agent:go` → `status:spec`, `agent:active`. |
| 2. Spec gate | Human comments `/approve-spec` on the PR | `agent-gate.yml` | Verifies commenter has write+; adds `status:ready`; comments `@copilot` build instructions naming the role agent. |
| 3. Build | `/approve-spec` | Copilot cloud agent | On approval the gate re-adds `[WIP] ` to the PR title, mirrors Delegation to `role:*` labels, and posts one `@copilot` comment: implement per Delegation acting as each named profile in order, run `npm run check`, fill the PR template, remove `[WIP]` last. Unknown or missing role → `agent:needs-human`, no default. When the title loses `[WIP]` the gate marks the PR ready → `status:review`. |
| 4. Review + QA | PR `ready_for_review` / new push after a fix | `factory-review.md`, `factory-qa.md` (gh-aw, parallel) | Reviewer submits a PR review (approve / request changes) against the spec with `[blocker]/[should]/[nit]`. QA runs `npm ci && npm run check` plus focused tests and posts a results comment with a pass/fail marker. Label `status:review`. |
| 5. Fix loop | Review requests changes or QA fails | `agent-gate.yml` | Adds `cycle:1`, then `cycle:2` (D050). Routes each blocker to the role that owns the affected files per the Delegation section, via `@copilot` comment. A fix request converts the PR to draft, re-adds `[WIP]`, and sets `status:ready`, so one re-review runs when Copilot removes `[WIP]`. When blockers remain after `cycle:2`, the gate adds `agent:needs-human` and stops (a human decides). |
| 6. Merge | All gates green | `agent-gate.yml` | Never if the PR touches a sensitive path (Phase 0 item 4; `Dockerfile`/`package*.json` at any depth). Eligible if the issue has `type:docs`, `type:chore`, or `follow-up` **and not** `type:feature`/`type:bug`/`playtest`: enable squash auto-merge with `COPILOT_ASSIGN_TOKEN` (so the merge triggers CI/deploy/close-out), or merge directly if GitHub reports the PR already clean. Otherwise label `agent:needs-human` and request David's review. |
| 7. Close-out | PR merged | existing GitHub + `agent-gate.yml` | `Closes #N` closes the issue; Follow-ups section items become `follow-up` issues; remove `agent:active`. |

Gates for merge: required CI (ruleset), Copilot code review completed, factory reviewer
review = approve, QA marker = pass, no `agent:needs-human`.

## Phases

**Phase 0: pilot (do first; stop and report).** On one follow-up issue (a PR #35 nit):
1. Assign Copilot via API with `custom_agent: builder`; confirm it honors the profile,
   `AGENTS.md`, and `copilot-setup-steps.yml`.
2. Confirm whether Copilot acts on an `@copilot` comment posted by a workflow
   (bot/PAT identity). If not, step 5 becomes "workflow summarizes blockers; a human
   posts one `@copilot` comment".
3. Confirm gh-aw can load `.github/agents/pr-reviewer.agent.md` and
   `factory-orchestrator.agent.md` (import) or decide to reference them from the workflow prompt.
4. Confirm whether CI on Copilot PRs needs "Approve and run workflows", and record
   the setting choice.
5. Confirm whether a cloud agent running `factory-orchestrator` can delegate to
   another `.github/agents` profile in-session. If yes, step 3 can be one assignment.
Report results; adjust this spec before Phase 1.

### Phase 0 results (2026-11-10, issue #36 → PR #37)

1. **Profile honored: yes.** Assignment via REST with `custom_agent: docs-writer` applied
   the profile, including its `model:` frontmatter. `Claude Haiku 5.5` is not available
   to the cloud agent, so the first run failed before starting. Re-assigning with
   `agent_assignment.model: "auto"` worked. **Dispatch must always send `model: "auto"`**
   (or a cloud-available model); the local VS Code model defaults (PR #25) stay unchanged.
   The change was correct and minimal. Copilot used the PR template but left
   "Linked issue" empty and appended its own `Fixes #36`, so the issue still links.
   It ignored the request to report which profile/instructions it loaded.
2. **`@copilot` fix loop: works.** A review-fix comment posted from David's account on PR #37
   started an "Addressing comment" session that pushed exactly the requested change (`56669df`).
   `COPILOT_ASSIGN_TOKEN` is David's token, so workflow comments should behave the same;
   confirm on the first Phase 1 run. Each fix push re-triggers CI approval (see 4).
3. **gh-aw can load profiles: yes (docs).** `{{#runtime-import .github/agents/<name>.agent.md}}`
   injects files under `.github/`; frontmatter fields such as `model:` are not applied.
4. **CI approval: disabled (David, 2026-11-11).** Runs on Copilot branches complete as
   `action_required` by default; David turned off "Require approval for workflow runs", so agent
   PR workflows now run automatically. (Fallback if re-enabled: `gh run rerun <id>` by a write user
   starts an `action_required` run; `POST .../approve` is fork-only and returns 403.)
   **Accepted risk until #47:** `DO_API_TOKEN` and `COPILOT_ASSIGN_TOKEN` are repo-level, so a
   Copilot PR that edits a `pull_request` workflow can read them. Mitigations: pipeline glue
   workflows run on `pull_request_target`/`workflow_run`/`issues`/`issue_comment` (base-branch
   definitions, never checking out PR code), so an agent PR cannot change the gate it is judged
   by; PRs touching sensitive paths (`.github/`, `deploy/`, `Dockerfile`, `scripts/`,
   `package*.json`, `factory-control/server/`) get `agent:needs-human` and never auto-merge.
   The gate workflow marks the PR ready (the agent leaves it as a draft), which triggers
   Copilot code review.
5. **Orchestrator delegation in-session: not yet tested.**

**Phase 1: build the chain** (files below). **Phase 2: docs + D057.**

## Files

- `.github/workflows/copilot-setup-steps.yml`: Node 22.18, `npm ci`.
- `.github/workflows/agent-dispatch.yml`, `.github/workflows/agent-gate.yml`.
- `.github/workflows/factory-triage.md` + `.lock.yml`, `factory-review.md` + `.lock.yml`, `factory-qa.md` + `.lock.yml` (compiled with `gh aw compile`).
- `.github/labels.yml`: `agent:go`, `agent:active`, `agent:needs-human`, `cycle:1`, `cycle:2`; run sync.
- `.github/agents/factory-orchestrator.agent.md` + skill: a short "cloud mode" section (triage-only on open; spec-only with a Delegation section on dispatch; no worktrees; stop at the spec gate).
- `docs/FACTORY.md`: GitHub pipeline section; `docs/DECISIONS.md`: D057 (after David confirms the final text).
- Repo setting: allow auto-merge.

## Guardrails

- Only triage+ can trigger `agent:go`; only write+ can `/approve-spec`. Workflows recheck permissions via API and ignore other actors.
- Issue/PR text is untrusted input: no `${{ }}` interpolation of user text into `run:`; gh-aw jobs stay read-only with safe outputs; no `pull_request_target` checkout of PR code.
- Glue workflows use least-privilege `permissions:`; the PAT is used only for assignment, `@copilot` comments, marking PRs ready, and enabling auto-merge/merging eligible PRs.
- Sensitive-path rule (see Phase 0 item 4) gates both CI re-runs and auto-merge.
- Concurrency: one active agent run per issue (`agent:active`); max open agent PRs configurable (default 3).
- Kill switch: repo variable `AGENT_PIPELINE_ENABLED` must be `true`.

## Decision D057 (approved by David, 2026-11-10)

Label-driven GitHub agent pipeline per this spec. Auto-merge allowed only for
`type:docs`, `type:chore`, and `follow-up` work after required CI, Copilot code
review, factory reviewer approval, and QA pass; `type:feature` and `playtest` work
needs human merge (phone/LAN validation stays human). Refines D048/D050's
"human approval" for those low-risk types only. `type:bug` needs a human merge; with mixed labels the strictest wins.

## Out of scope

Projects board, deploy gating, Dependabot, replacing the local VS Code factory (it stays supported).

## Acceptance criteria

- Pilot results recorded for the five questions in Phase 0.
- A `type:docs` issue labeled `agent:go` reaches a merged PR with only a `/approve-spec` comment from a human; the issue closes.
- Every issue opened by a triage+ collaborator (factory unit, bug, or other) gets exactly one triage comment and orchestrator-chosen `type:*`/`role:*`/`lane:*` labels, and no work starts without `agent:go`.
- An issue whose spec names `artist` (or `docs-writer`) is built by that profile, not `builder`; a missing/unknown role stops at `agent:needs-human`.
- A `type:feature` issue reaches `agent:needs-human` with all gates green and is not auto-merged.
- A non-collaborator applying labels or commenting `/approve-spec` has no effect.
- A review blocker triggers a fix; the cycle labels stop the loop after `cycle:2` (D050).
- With `AGENT_PIPELINE_ENABLED` unset, no workflow takes action.
- `npm run check` passes; workflows pass `actionlint` and `gh aw compile`.

## Open questions

- Copilot premium-request budget per unit (each role run costs requests).
- Whether `factory-qa` also runs a headless browser smoke (adds time; T8 territory).
