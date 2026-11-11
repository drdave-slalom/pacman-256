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
  orchestrator's decision. Workflows execute the delegation by assigning the named
  profile, unless the pilot shows the cloud agent can delegate to other
  `.github/agents` profiles in-session (then the orchestrator delegates directly).
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
| 0. Triage | Every issue `opened` / `reopened` (any template) | `factory-triage.md` (gh-aw, orchestrator profile, read-only) | Classifies type, lane, and the role agent(s) needed; checks readiness (AC, validation, duplicates, conflicts with `docs/DECISIONS.md`); suggests a split into sub-issues when one unit spans roles that can't share a PR. Safe outputs: `type:*`/`lane:*`/`role:*` labels and one triage comment with the plan and any gaps. Labels `status:spec` (ready) or `agent:needs-human` (gaps/rule questions). Never starts work. |
| 1. Queue | Human adds `agent:go` to an issue | `agent-dispatch.yml` | Verifies labeler has triage+ and triage passed; assigns Copilot with `custom_agent: factory-orchestrator` and instructions "spec only: write `SPEC/<id>-<slug>.md` including a **Delegation** section (ordered role agent per step, QA depth fast/slow), open a draft PR with `Closes #N`, stop". Labels: `agent:go` → `status:spec`, `agent:active`. |
| 2. Spec gate | Human comments `/approve-spec` on the PR | `agent-gate.yml` | Verifies commenter has write+; adds `status:ready`; comments `@copilot` build instructions naming the role agent. |
| 3. Build | `status:ready` | Copilot cloud agent | `agent-gate.yml` reads the spec's Delegation section and assigns each step's profile in order on the same PR (`builder`, `artist`, `gameplay-designer`, `docs-writer`). Unknown or missing role → `agent:needs-human`, no default. Each step runs `npm run check`; the last fills the PR template and marks the PR ready. |
| 4. Review + QA | PR `ready_for_review` / new push after a fix | `factory-review.md`, `factory-qa.md` (gh-aw, parallel) | Reviewer submits a PR review (approve / request changes) against the spec with `[blocker]/[should]/[nit]`. QA runs `npm ci && npm run check` plus focused tests and posts a results comment with a pass/fail marker. Label `status:review`. |
| 5. Fix loop | Review requests changes or QA fails | `agent-gate.yml` | Adds `cycle:1`, then `cycle:2` (D050). Routes each blocker to the role that owns the affected files per the Delegation section, via `@copilot` comment. After `cycle:2`, only blockers reopen work; otherwise `agent:needs-human`. |
| 6. Merge | All gates green | `agent-gate.yml` | Eligible if the issue has `type:docs`, `type:chore`, or `follow-up` **and not** `type:feature`/`playtest`: `gh pr merge --auto --squash`. Otherwise label `agent:needs-human` and request David's review. |
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
2. **`@copilot` from a workflow: not yet tested directly.** Comments posted with
   `COPILOT_ASSIGN_TOKEN` are authored by David's account, so they should behave like
   human comments. Verify in Phase 1.
3. **gh-aw can load profiles: yes (docs).** `{{#runtime-import .github/agents/<name>.agent.md}}`
   injects files under `.github/`; frontmatter fields such as `model:` are not applied.
4. **CI approval: required by default.** CI and `pr-description.yml` runs on the Copilot
   branch completed as `action_required`, and the API cannot approve them (`POST
   .../runs/{id}/approve` returns 403 for non-fork runs). **Decision (David, 2026-11-10):
   auto-approve.** Repo Settings → Copilot → cloud agent → Policies → disable
   "Require approval for workflow runs" (admin, UI only). Compensating guardrail:
   `agent-gate.yml` labels any agent PR that changes `.github/workflows/`,
   `.github/agents/`, `.github/skills/`, or `deploy/` with `agent:needs-human` and never
   auto-merges it. Secrets must not be reachable from agent branches: move `DO_API_TOKEN` to a `production` environment secret and `COPILOT_ASSIGN_TOKEN` to an `agent` environment, both limited to deployments from `main` (verified 2026-11-10: both were repo-level).
   The gate workflow must also mark the PR ready itself (the agent leaves it as a draft).
5. **Orchestrator delegation in-session: not yet tested.**

**Phase 1: build the chain** (files below). **Phase 2: docs + D056.**

## Files

- `.github/workflows/copilot-setup-steps.yml`: Node 22.18, `npm ci`.
- `.github/workflows/agent-dispatch.yml`, `.github/workflows/agent-gate.yml`.
- `.github/workflows/factory-triage.md` + `.lock.yml`, `factory-review.md` + `.lock.yml`, `factory-qa.md` + `.lock.yml` (compiled with `gh aw compile`).
- `.github/labels.yml`: `agent:go`, `agent:active`, `agent:needs-human`, `cycle:1`, `cycle:2`; run sync.
- `.github/agents/factory-orchestrator.agent.md` + skill: a short "cloud mode" section (triage-only on open; spec-only with a Delegation section on dispatch; no worktrees; stop at the spec gate).
- `docs/FACTORY.md`: GitHub pipeline section; `docs/DECISIONS.md`: D056 (after David confirms the final text).
- Repo setting: allow auto-merge.

## Guardrails

- Only triage+ can trigger `agent:go`; only write+ can `/approve-spec`. Workflows recheck permissions via API and ignore other actors.
- Issue/PR text is untrusted input: no `${{ }}` interpolation of user text into `run:`; gh-aw jobs stay read-only with safe outputs; no `pull_request_target` checkout of PR code.
- Glue workflows use least-privilege `permissions:`; PAT only in the assignment step.
- Concurrency: one active agent run per issue (`agent:active`); max open agent PRs configurable (default 3).
- Kill switch: repo variable `AGENT_PIPELINE_ENABLED` must be `true`.

## Decision D056 (approved by David, 2026-11-10)

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
- Every newly opened issue (factory unit, bug, or other) gets exactly one triage comment and orchestrator-chosen `type:*`/`role:*`/`lane:*` labels, and no work starts without `agent:go`.
- An issue whose spec names `artist` (or `docs-writer`) is built by that profile, not `builder`; a missing/unknown role stops at `agent:needs-human`.
- A `type:feature` issue reaches `agent:needs-human` with all gates green and is not auto-merged.
- A non-collaborator applying labels or commenting `/approve-spec` has no effect.
- A review blocker triggers a fix; the cycle labels stop the loop after `cycle:2` (D050).
- With `AGENT_PIPELINE_ENABLED` unset, no workflow takes action.
- `npm run check` passes; workflows pass `actionlint` and `gh aw compile`.

## Open questions

- Copilot premium-request budget per unit (each role run costs requests).
- Whether `factory-qa` also runs a headless browser smoke (adds time; T8 territory).
