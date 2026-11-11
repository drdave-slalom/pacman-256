# Local Software Factory

This is the operating guide for the **local, agent-powered software factory**
for pacman-256. It defines how we break work into bounded units and distribute
them across role-specific subagents, with a human Lead owning acceptance and
integration. The factory supports GitHub Copilot in VS Code and the original
Herdr (Pi Herdsman) runtime. A cloud variant runs on GitHub issues and PRs;
see [GitHub agent pipeline (cloud mode)](#github-agent-pipeline-cloud-mode).

**Lead sessions should load the `factory-orchestrator` skill** to run this
workflow; it is the executable form of this guide. The skill is dual-located:

- Canonical instructions: `.github/skills/factory-orchestrator/SKILL.md`
  (loaded by Copilot; the single source of truth).
- Pi mirror: `.agents/skills/factory-orchestrator/SKILL.md` (loads the
  canonical file, so the two never drift).
- Copilot role profiles: `.github/agents/*.agent.md` (workspace agents used
  for role-based delegation in VS Code).

The factory is a *process*, not a machine: agents are proposals that produce
evidence and handoffs; people stay responsible. It complements the GitHub
Actions CI (which validates pushed code) by doing the per-task work locally:
spec/breakdown → implementation → review → QA → integration (PR + CI watch).

## Roles

Herdr role definitions remain in `.pi/agents/`. Copilot workspace profiles are
in `.github/agents/`; both runtimes use the matching role skill in
`.github/skills/`.

| Profile | Project skill | Typical assignment | Read-only? |
| --- | --- | --- | --- |
| `builder` | `builder` | Implement a resolved change; build/test/package; fix build pipeline | no |
| `pr-reviewer` | `pr-reviewer` | Independently review a diff/PR/plan | **yes** |
| `qa-tester` | `qa-tester` | Run tests/probes, reproduce bugs, verify fixes | no (tests only) |
| `gameplay-designer` | `gameplay-designer` | Design/tune a mechanic; write short spec or constant changes | no |
| `artist` | `artist` | Create/edit original sprites, tiles, UI, audio | no |
| `docs-writer` | `docs-writer` | Update README/docs/decision log | no |
| `scout` | runtime-specific | Read-only reconnaissance of unfamiliar code | **yes** |
| `researcher` | runtime-specific | External/authoritative research | **yes** |

Herdr supplies bundled `scout` and `researcher` definitions. In Copilot, use an
available read-only subagent for these tasks or do the bounded research in the
Lead session; the six project role profiles above have Copilot equivalents.

## Pipeline

```text
GitHub issue / spec / ask
      │  (Lead)
      ▼
0. Gate      → implementation work? write spec(s) + delegate; Lead does not implement
      │
      ▼
1. Clarify → find or (with user confirmation) create the unit's GitHub issue;
             acceptance criteria in SPEC/<task-id>-<slug>.md (links the issue)
      │
      ▼
2. Break down → bounded units; one executor per unit; no overlapping writers
      │
      ▼
3. Dispatch  → runtime-native subagent using the narrowest role profile
      │
      ▼
4. Execute   → agent works, validates, returns a concise handoff
      │
      ▼
5. Review    → independent read-only pr-reviewer against the spec (required before any PR or merge)
      │
      ▼
6. QA       → qa-tester verifies behavior with real commands (required before any PR or merge;
              fast QA may run alongside review)
      │
      ▼
7. Integrate → human approval; PR via open-pr by default (direct merge only if user approves); record decisions
      │
      ▼
8. CI        → watch PR checks (or the main run after a direct merge); owning writer fixes code failures; report final status
```

Stages 3–6 can run concurrently for **independent** units. Keep dependent work
sequential and provide the next agent with the complete accepted handoff and
relevant inputs.

### Standing workflow gates

These apply to every request without the user restating them (D048):

1. **Spec first, then delegate.** For implementation work, the Lead writes one
   or more short specs in `SPEC/<task-id>-<slug>.md` (goal, scope,
   out-of-scope, assumptions, acceptance criteria, validation) and hands each
   to the matching role agent in its own worktree. The Lead does not make
   implementation edits for application behavior, tests, build config, or
   multi-file changes. Research, read-only review, simple lookups, and small
   non-code edits may stay direct. If subagents or the needed role are
   unavailable, stop and ask the user; only the user may waive this gate.
2. **Test and review before any PR or merge.** `qa-tester` verifies with real commands
   and the read-only `pr-reviewer` reviews the diff against the spec; both are
   required before any integration, PR or direct merge. The owning writer
   fixes blockers, then both re-verify. Run review and fast QA (`npm run
   check`, focused tests) in parallel; run slow QA (browser E2E, multi-client
   probes) after review blockers are fixed, re-running it only if its own
   findings are fixed. Small or low-risk changes may run everything in parallel.
   At most two review/fix cycles per unit (D050; a cycle is one review/QA pass
   plus its fixes); from the third pass on only blockers
   (failed acceptance criterion, crash/data integrity, security, regression)
   reopen work, each with one targeted fix re-checked alone. Other findings
   become PR follow-ups, filed as `follow-up` issues linked to the PR. CI
   failures are always fixed. Integrate via PR by default; merge
   directly into `main` only with explicit user approval. The PR body fills
   `.github/pull_request_template.md`: `Closes #N` for the unit's issue (or
   "No issue" if none), the spec link, QA results, the review verdict, the
   three-way reconciliation of spec, change, and tests, and follow-ups.
3. **Watch CI after opening a PR.** Run `gh pr checks <pr> --watch`; right
   after creation it may report "no checks reported", so wait and retry. After
   a user-approved direct merge, watch the `main` push run of `ci.yml`
   (`gh run list --workflow ci.yml --branch main --commit <merge-sha> -L 1`, then `gh run watch <run-id>`). On
   failure, find the run ID with `gh pr checks <pr> --json name,state,link`
   (the ID is in the link) or `gh run list --branch <branch> --commit
   <head-sha> --status failure -L 1`, read `gh run view <run-id> --log-failed`, dispatch code fixes to the
   owning writer, push, and watch again. Re-run `qa-tester` (and `pr-reviewer`
   for non-trivial fixes) on CI fixes before merge; a fix after a direct merge
   goes through a PR or another user-approved merge. Report non-code failures (for example
   `pr-description.yml` missing `COPILOT_GITHUB_TOKEN`, transient AI errors, or
   generated-heading validation) to the user instead of dispatching a code
   fix. Report the final CI status; work is not done while CI is pending or
   red. Remove the worktree only after CI is green and the PR is merged (or,
   for a direct merge, the `main` run is green).

### GitHub tracker

GitHub Issues is the factory tracker (D055; scoping profile
`.initiative-scoping/profile.md`, tracker `github`).

- **Units start from an issue.** Before dispatch, the Lead looks up the unit's
  issue (title prefixed with the unit ID, for example `T6`) or, with user
  confirmation, creates one from the `factory-unit` issue form. The spec links
  the issue. Bugs use the `bug` form; blank issues are disabled
  (`.github/ISSUE_TEMPLATE/`).
- **PRs close issues.** PRs fill `.github/pull_request_template.md` and include
  `Closes #N` when an issue exists, or "No issue" if none. Leave the
  auto-generated description markers at the end for `pr-description.yml`.
- **Labels** are defined in `.github/labels.yml`: `type:*`
  (feature/bug/chore/docs), `role:*` (builder/qa/review/design/art/docs),
  `lane:A`/`lane:B`/`lane:C`, `status:*` (spec/ready/in-progress/review),
  `blocked`, `follow-up`, and `playtest`. Sync them to the repo with
  `node scripts/sync-labels.mjs` (`--dry-run` previews); syncing writes to
  GitHub, so get user confirmation first.
- **Deferred review findings** (D050) become `follow-up` issues linked to the PR.
- **Required CI.** The `main` ruleset (`main-copilot-review`) requires the
  checks `Validate (Node 22.18.0)` and `Validate (Node 24.x)` from `ci.yml`, in
  addition to requiring PRs, blocking force-push/deletion, and running Copilot
  code review. No approvals are required. Renaming the CI job or its Node
  matrix changes the check names, so update the ruleset in the same change.

### Copilot in VS Code

Use the `factory-orchestrator` skill or the `factory-orchestrator` workspace
agent in `.github/agents/`. In VS Code's Local harness, enable **Run Subagent**
and ask the orchestrator to dispatch with the matching role profile. Give each
subagent a self-contained task with its worktree path, allowed scope,
acceptance criteria, validation commands, expected handoff, and escalation
boundary. Local subagents do not use Herdr/Pi `files` or result references;
include the necessary context and accepted handoff text directly. If the
selected Copilot harness does not support subagents, stop and ask the user;
they may select the role profile directly in a separate chat and pass the same
self-contained task and handoff manually, or waive the gate.

#### Copilot model defaults

The workspace role profiles set these model defaults for Copilot in VS Code's
Local harness:

| Role profile | Model |
|---|---|
| `builder` | Claude Sonnet 5.5 |
| `pr-reviewer` | Claude Sonnet 5.5 |
| `qa-tester` | Claude Sonnet 5.5 |
| `gameplay-designer` | Claude Sonnet 5.5 |
| `artist` | Claude Sonnet 5.5 |
| `docs-writer` | Claude Haiku 5.5 |
| `factory-orchestrator` | No profile override |

When a worker profile declares `model`, the Local harness selects that model
for the worker instead of following the model selected for the orchestrator's
chat. The orchestrator profile intentionally omits `model`, so its conversation
continues to use the user's selected chat model.

For a Copilot-only setup check, run:

```bash
scripts/factory-setup.sh --copilot
```

In the VS Code Agent Customizations editor, verify the workspace agents appear
and try a small, read-only task before relying on delegation. The check script
validates repository files, not VS Code's active harness or agent runtime.

#### Copilot smoke tests

`npm test` (and therefore CI) runs `scripts/factory-smoke.test.mjs`, which
checks the repository side deterministically:

- each `.github/agents/*.agent.md` name matches its file, has a description,
  and has a matching `.github/skills/<role>/SKILL.md`;
- `ROLE_DEFS` in `scripts/factory-setup.sh` matches the role profiles;
- `pr-reviewer` declares only `read` and `search` tools;
- `scripts/factory-setup.sh --copilot` passes without Pi or Herdr on `PATH`,
  and fails when a profile is missing or misnamed;
- `scripts/factory-worktree.sh` creates an isolated sibling worktree on
  `factory/<unit>`, leaves the primary checkout clean, and removes it cleanly.

Agent discovery and delegation depend on the live VS Code harness and model,
so verify them manually after changing agent profiles or orchestrator guidance,
and record the result on the PR:

| # | Step | Pass when |
|---|------|-----------|
| 1 | Open the agent picker / Agent Customizations editor. | All seven factory profiles appear, each once. |
| 2 | Create a unit with `scripts/factory-worktree.sh create smoke`, then ask `factory-orchestrator` to delegate a one-line docs edit there with `WORKTREE=<path>`. | The debug log or chat shows a `builder` subagent call; the orchestrator does not edit the file itself. |
| 3 | Read the builder handoff. | It reports `git rev-parse --show-toplevel` inside the worktree and follows the handoff contract below. |
| 4 | Run `git status` in the primary checkout. | Clean; the edit exists only in the worktree. |
| 5 | Ask `pr-reviewer` to fix a typo in the worktree. | It reports findings but changes no files. |
| 6 | Discard the edit and run `scripts/factory-worktree.sh remove smoke`. | Worktree and `factory/smoke` branch are gone. |

### Herdr / Pi

Use the `.pi/agents/` definitions with Herdr's `delegate_agent` interface.
Create a separate worktree for each unit, pass relevant files, and forward
completed-agent result references exactly as described below. The default
`scripts/factory-setup.sh` mode continues to validate this original runtime.

## GitHub agent pipeline (cloud mode)

A label-driven pipeline runs the same SDLC on GitHub without a VS Code
session (D057, [spec](../SPEC/github-agent-pipeline.md)). The local VS Code /
Herdr flow above stays supported; the two are complementary.
[`factory-control/`](../factory-control/README.md) remains the local operator
surface (TUI + read-only web mirror) for local units.

**When to use which:**

- **Cloud:** well-specified, low-risk units (docs, chores, follow-ups) and
  first drafts of features that need no phone or LAN check during the build.
- **Local (VS Code / Herdr):** gameplay and multiplayer work that needs
  phone/LAN validation, multi-unit parallel work in worktrees, or anything
  needing close human steering.

**Moving parts:** `.github/workflows/copilot-setup-steps.yml` (Node 22.18 +
`npm ci` for the cloud agent); `agent-dispatch.yml` and `agent-gate.yml`
(label/comment glue, logic in `.github/scripts/agent-gate.mjs`, always loaded
from the default branch); and the gh-aw workflows `factory-triage.md`,
`factory-review.md`, and `factory-qa.md` (each compiled to a `.lock.yml`). The
builder is the Copilot cloud agent; triage, review, and QA are read-only and
write only through gh-aw safe outputs.

**Setup prerequisites:**

- Settings → Actions → General: **Allow GitHub Actions to create and approve
  pull requests** on (the factory review submits an APPROVE review).
- Settings → General: **Allow auto-merge** on.
- Secrets: `COPILOT_ASSIGN_TOKEN` (user PAT for Copilot assignment, `@copilot`
  comments, reading Copilot session state from the agent tasks API, marking
  PRs ready, and merging) and `COPILOT_GITHUB_TOKEN` (gh-aw).
- Variable `AGENT_PIPELINE_ENABLED` = `true`. Optional: `AGENT_MAX_ACTIVE`
  (default 3) and `AGENT_MERGE_REVIEWER` (default: the repo owner).
- Labels from `.github/labels.yml` synced (`node scripts/sync-labels.mjs`).
- Settings → Environments → `copilot`: the deployment branch policy must allow
  `copilot/*` (not only `main`); otherwise the Copilot cloud agent job is
  rejected (`deployment_rejected`).
- Do **not** set `GH_AW_GITHUB_TOKEN`: it changes the identity the gh-aw
  reviewer posts as, so the gate no longer recognizes its reviews and verdicts.
- While "Allow GitHub Actions to create and approve pull requests" is on, any
  workflow can satisfy a required-approval rule, so do not rely on required
  approvals as a human gate; human gates are `agent:go`, `/approve-spec`, and
  `agent:needs-human`.

| Step | Trigger | Result |
|---|---|---|
| 0. Triage | Issue opened/reopened by a triage+ collaborator (others are not triaged) | `factory-triage` (orchestrator profile, read-only) adds `type:*`/`lane:*`/`role:*` labels and one triage comment; labels `status:spec` if ready or `agent:needs-human` if gaps. Never starts work. |
| 1. Queue | A triage+ user (not a bot) adds `agent:go` | `agent-dispatch.yml` assigns Copilot (`factory-orchestrator` profile, model `auto`) to write only `SPEC/<id>-<slug>.md` with a `## Delegation` section and open a draft PR; the instructions forbid subagents and ask for a final PR comment summarising the spec. Copilot cannot edit the PR title or body, so the gate owns `[WIP]` and `Closes #N` (see *Session completion* below). `agent:go` → `agent:active` + `status:spec`; stale `cycle:*`, `status:ready`/`status:review`, and `role:*` labels are cleared. |
| 2. Spec gate | A write+ user (not a bot) comments `/approve-spec`, or `/approve-spec <sha>` which must match the PR head | A PR with no linked issue carrying `agent:active` is ignored; multiple active linked issues stop the pipeline with `agent:needs-human`. Approval is refused with a comment while the Copilot agent tasks API shows a session in progress or queued; if that API cannot confirm the session state, it is refused with a comment while the title starts with `[WIP]`. Once the session is finished, the approver can remove `[WIP]` if needed and comment again. `agent-gate.yml` binds the PR to its single active linked issue and checks that it changes exactly one `SPEC/*.md` with a valid Delegation section; other spec-gate errors stop with `agent:needs-human`. On approval, it strips `[WIP]`, writes `Closes #N` under "Linked issue" in the PR body if that section does not already close the issue, re-adds `[WIP] ` to the title for the build, mirrors Delegation to `role:*` labels, sets `status:ready`, and posts one `@copilot` build comment. |
| 3. Build | That `@copilot` comment | Copilot implements per the Delegation in its own session, acting as each named profile in order (reading `.github/agents/<profile>.agent.md` and `.github/skills/<profile>/SKILL.md`; no subagents or custom agents), runs `npm run check`, and ends with a PR comment summarising changes and validation. When that session has ended, the gate strips `[WIP]`, marks the PR ready, and sets `status:review`. |
| 4. Review + QA | PR ready / new push | `factory-review` submits a `github-actions[bot]` APPROVE or REQUEST_CHANGES review on the head commit (`[blocker]/[should]/[nit]`). `factory-qa` runs `npm ci && npm run check` plus focused tests; its `qa-verdict` job posts `<!-- factory-qa:pass\|fail -->` with `Head: <sha>` and `Run: <id>`. For the PR head, the gate checks the latest Factory Review and Factory QA workflow runs; a QA verdict counts only when both its head SHA and `Run:` ID match the latest QA run. |
| 5. Fix cycles | Changes requested, QA fail, or failing required checks | `cycle:1`, then `cycle:2` (D050). The gate turns the PR back to draft with `[WIP]` and `status:ready` and posts one `@copilot` comment listing the blockers. When Copilot's fix session ends, the gate strips `[WIP]` and marks the PR ready, which triggers exactly one re-review, so intermediate pushes don't burn cycles. If blockers are raised again on the same head (the fix session ended without new commits), the gate stops with `agent:needs-human` and names a possible false positive instead of waiting. Blockers after `cycle:2` → `agent:needs-human`. Review/QA finishing without a verdict → `agent:needs-human`. |
| 6. Merge | Required CI green, Copilot code review present, factory review approved, QA pass, no `agent:needs-human` | Auto-merge (squash, enabled with `COPILOT_ASSIGN_TOKEN` so the merge triggers CI, deploy, and close-out; bound to the reviewed head SHA, so any new push disables it and needs fresh review and QA) only when the issue has `type:docs`, `type:chore`, or `follow-up` and **not** `type:feature`, `type:bug`, or `playtest`; the strictest label wins. If GitHub reports the PR already clean, the gate squash-merges directly. PRs touching sensitive paths in any commit of the PR (`.github/`, `deploy/`, `scripts/`, `factory-control/server/`, or at any depth and case-insensitive: `Dockerfile`, `Dockerfile.*`, `.dockerignore`, `.npmrc`, `package.json`, `package-lock.json`) always need a human. Otherwise: `agent:needs-human` plus a review request to `AGENT_MERGE_REVIEWER`. |
| 7. Close-out | PR merged | `Closes #N` closes the issue; Follow-ups items become `follow-up` issues; `agent:active`, `status:*`, `cycle:*`, and `agent:needs-human` are removed. A PR closed unmerged removes `agent:active`, `cycle:*`, `status:ready`/`status:review`, and `role:*`, and adds `agent:needs-human`. |

**Session completion.** Copilot cannot edit PR titles or bodies, so `[WIP]`
is not a completion signal. When Copilot replies on a pipeline PR (it posts a
comment as `Copilot` when a comment-triggered session ends), `agent-gate.yml`
asks the Copilot agent tasks API (`GET /agents/repos/{owner}/{repo}/tasks`,
with `COPILOT_ASSIGN_TOKEN`) for the task linked to the PR (pull artifact id
or head branch). If every session has ended (`completed`, `failed`,
`cancelled`, `timed_out`; any other state is unknown), it strips `[WIP]`. At
`status:ready` it marks the PR ready (`status:review`) only if a session
started after the gate's latest build or fix hand-off comment (hidden
`agent-gate:build`/`agent-gate:fix` marker), so the earlier spec or build
session never counts. A draft is never marked ready just because its title
lacks `[WIP]`; only this check or an explicit "Ready for review" does that.
It re-checks a few times while a session still looks active. API errors count
as unknown: the gate logs them and does nothing. The gate also does not
enable auto-merge while a Copilot session is active. A manual `agent-gate.yml` run with
`pr_number` runs the same check before evaluating gates.

**Delegation section.** The spec's `## Delegation` lists one line per step,
`- <profile>: <task>` (profiles: `builder`, `artist`, `gameplay-designer`,
`docs-writer`), plus `QA depth: fast|slow`.

**Labels** (`.github/labels.yml`): `agent:go` (start), `agent:active` (one
agent run per issue; at most `AGENT_MAX_ACTIVE` issues at once),
`agent:needs-human` (pipeline stopped; a person must act), `cycle:1`/`cycle:2`
(D050 counter). They work alongside the D055 `type:*`, `role:*`, `lane:*`, and
`status:*` labels.

**Kill switch.** Workflows act only while repo variable `AGENT_PIPELINE_ENABLED`
is `true`. Unset it or set any other value to stop all pipeline actions.

**Stop, re-check, or restart a unit.**

- Stop: remove `agent:active`, unassign Copilot from the issue/PR, and add
  `agent:needs-human`.
- Small fix on an open PR: post one `@copilot` comment describing the change.
- Re-check gates (for example after a late Copilot code review, or when a
  finished Copilot session left the PR in draft): run
  `agent-gate.yml` manually with input `pr_number`
  (`gh workflow run agent-gate.yml -f pr_number=<n>`). Manual evaluation does
  nothing while `agent:needs-human` is set; resolve the issue and remove that
  label before re-checking.
- Restart dispatch (for example after a PR was closed unmerged): close any
  open agent PR for the issue, unassign Copilot, remove `agent:active` and
  `agent:needs-human`, then a triage+ user removes and re-adds `agent:go`. The
  issue must be open. Dispatch clears stale `cycle:*`, `status:ready`/`status:review`,
  and `role:*` labels itself. With `agent:needs-human` present, dispatch only
  comments and does nothing. When the `AGENT_MAX_ACTIVE` limit is reached,
  `agent:go` stays queued; remove and re-add it when a slot frees up.
- `/approve-spec` is ignored unless the issue has `status:spec`, and refused
  while Copilot is still working (or, if the tasks API fails, while the title
  starts with `[WIP]`); with `agent:needs-human` present, remove it and
  comment `/approve-spec` again.

**Permissions.** Only triage+ users can trigger `agent:go`; only write+ users
can `/approve-spec`; bot actors are ignored at both human gates. Workflows
recheck permissions via the API and act only on Copilot-authored PRs bound to
exactly one linked issue with `agent:active`. Issue and PR text is
untrusted input.

**Known limits.**

- No phone or LAN validation in the cloud; `playtest` and gameplay work still
  needs a human check before merge.
- Dispatch sends model `auto`: the local role-profile models (for example
  Claude Haiku 5.5 for `docs-writer`) are not available to the cloud agent.
- Copilot leaves PRs as drafts and cannot edit PR titles or bodies; the gate
  strips `[WIP]` and marks the PR ready when the Copilot session has ended,
  which starts Copilot code review. Close-out still reads `## Follow-ups` from
  the PR body, which Copilot cannot fill.
- No subagents in cloud mode: role profiles pin models (for example
  `docs-writer`), and a subagent started with the `task` tool fails in the
  cloud session (`thinking.type.enabled` 400). The cloud agent acts as each
  profile in-session instead; the instructions forbid subagents.
- Completion detection depends on Copilot's end-of-session reply comment
  and on the agent tasks API (not a documented stable API). If the PR stays in
  draft after Copilot has finished, run `agent-gate.yml` manually with
  `pr_number`.
- The factory reviewer may miss changes to instruction files such as
  `AGENTS.md` in its diff view; its prompt now requires checking blockers
  against the head commit with git. A repeated blocker on an unchanged head
  stops at `agent:needs-human`. For a false positive, dismiss the factory
  review, remove `agent:needs-human`, then re-run the relevant Factory Review
  or Factory QA run (`gh run rerun <id>`), which re-triggers the gate;
  dismissing the review alone does not restart the pipeline. Manual gate
  evaluation does nothing until `agent:needs-human` is removed.
- **Accepted secret risk until issue #47:** `DO_API_TOKEN` and the
  `COPILOT_ASSIGN_TOKEN` PAT are repo-level, and workflow-run approval for
  Copilot branches is off, so an agent PR that edits a `pull_request` workflow
  could read them. Mitigations: glue workflows run from base-branch definitions
  (`pull_request_target`, `workflow_run`, `issues`, `issue_comment`) and never
  check out PR code, and sensitive-path PRs never auto-merge. Residual risk:
  a workflow on an agent PR branch can still read repo secrets and, through
  `GITHUB_TOKEN`, post as `github-actions[bot]` (the identity the gate trusts
  for review and QA verdicts) until #47 is done and workflow-run approval is
  re-enabled.

## Worktree isolation

Each concurrent writing agent gets its **own git worktree** so parallel agents
never write to the same files or the primary checkout. The Lead creates them
with `scripts/factory-worktree.sh`.

```bash
# Create a sibling worktree (default parent: /home/chase) on branch factory/<unit>,
# and run npm ci inside it (separate node_modules).
scripts/factory-worktree.sh create <unit> [base]
# → prints WORKTREE=<path> and BRANCH=factory/<unit>
```

Rules:

- **Create one worktree per unit before delegating**, and pass the `WORKTREE`
  path in the agent's task. Agent definitions are instructed to cd into it,
  verify with `git rev-parse --show-toplevel`, and never touch the primary
  checkout.
- **One writer per worktree.** Do not delegate overlapping writers to one
  worktree; do not run two writing agents in the same worktree. A read-only
  reviewer may run alongside one agent; during parallel review, `qa-tester`
  only runs commands and reports test gaps instead of editing.
- **Read-only roles** (pr-reviewer, scout, researcher) are scoped to the
  worktree path but never write anywhere.
- **Dependencies are per-worktree** (`npm ci` inside the worktree). Never share
  node_modules across worktrees.
- **Integrate after acceptance:** after review and QA, review the
  `factory/<unit>` branch and open a PR (or, only with explicit user approval,
  merge it into `main`). Keep the worktree so the owning writer can fix CI
  failures; remove it only after CI is green and the PR is merged (or the
  direct merge's `main` run is green):

  ```bash
  scripts/factory-worktree.sh remove <unit>
  ```

- Worktrees are siblings of the repo (e.g. `/home/chase/pacman-256-wt-<unit>`),
  so the main checkout stays clean and agents can run in parallel safely.

## Work-breakdown rules

- **One executor per unresolved unit.** Once you delegate, the agent owns that
  scope until it resolves. Do not execute or reassign overlapping work.
- **Bounded assignments only.** Each `task` must include:
  1. objective and scope (what is in/out);
  2. required inputs and paths;
  3. acceptance criteria;
  4. validation expectations (exact commands);
  5. expected handoff;
  6. escalation boundary (what to ask the owner about).
- **Reuse evidence, don't duplicate it.** Pass the full accepted handoff and
  relevant context to dependent Copilot subagents. With Herdr/Pi, pass
  completed-Agent result refs exactly (e.g. `result:agent#3`) via `files`.
- **No competing writers.** Never overlap file-ownership boundaries; one agent
  writes a given file at a time.
- **Prefer the focused definition.** Use `builder` for resolved implementation,
  `scout` for recon, `qa-tester` for verification, `pr-reviewer` for review.
- **Keep it local-first.** Validate with documented commands (`npm run check`,
  local-network smoke test). Cloud deployment changes are separate and
  deferred.

## Dispatch example

The unit name and `SPEC/t5-countdown.md` below are a **hypothetical example
path**, not an existing file.

From a Lead session:

1. Find (or, with user confirmation, create) the unit's GitHub issue, write
   the spec linking it (hypothetical example: `SPEC/t5-countdown.md`), and break it
   into units (one per file-surface/concern).
2. For each unit, create its isolated worktree:

   ```bash
   scripts/factory-worktree.sh create t5-countdown
   ```

3. Delegate the unit, naming its spec and worktree:

   ```text
   Copilot subagent: builder (VS Code Local harness)
     task: Implement SPEC/t5-countdown.md (T5 countdown + baseline contact
           elimination per the approved contract).
           WORKTREE=/home/chase/pacman-256-wt-t5-countdown;
           do all edits and commands inside that worktree only.
           Acceptance = authoritative round completes with tests for
           timeout/simultaneous-elimination/disconnect; run npm run check there.
     context: SPEC/t5-countdown.md, docs/GAME-CONTRACT.md, docs/DECISIONS.md
   ```

4. When it resolves, pass its complete handoff to the reviewer and QA (same
   worktree; both required before any PR or merge):

   ```text
   Copilot subagent: pr-reviewer
     task: Review the T5 implementation in
           WORKTREE=/home/chase/pacman-256-wt-t5-countdown against
           SPEC/t5-countdown.md for contract compliance, mobile usability,
           multiplayer edge cases, regressions. Read-only.
     context: builder's complete handoff and the worktree diff

   Copilot subagent: qa-tester
     task: Verify SPEC/t5-countdown.md acceptance criteria in
           WORKTREE=/home/chase/pacman-256-wt-t5-countdown with real commands
           (npm run check plus focused tests); report actual output.
     context: builder's complete handoff
   ```

   Route any blockers back to the builder, then re-run review and QA.

For Herdr/Pi, replace “Copilot subagent” with `delegate_agent`, use the
matching `.pi/agents/` definition, and pass the result reference in `files`.

5. Integrate accepted work with human approval, after review and QA: open a PR
   with the `open-pr` skill (body fills the PR template: `Closes #N` when an
   issue exists, or "No issue" if none, spec link, QA, review, reconciliation,
   follow-ups). Merge `factory/t5-countdown` directly into `main` only
   with explicit user approval. Run the build and record in
   `docs/DECISIONS.md`.
6. Watch CI as described in gate 3: `gh pr checks <pr> --watch` for a PR, or
   the `main` push run (`gh run list --workflow ci.yml --branch main --commit <merge-sha> -L 1`, then
   `gh run watch <run-id>`) after a direct merge. Send code failures to the
   builder, report non-code failures to the user, watch again, and report the
   final CI status.
7. Only after CI is green and the PR is merged (or the direct merge's `main`
   run is green), run `scripts/factory-worktree.sh remove t5-countdown`.

## Handoff contract (what agents must return)

Every factory agent returns a concise handoff:

- what it inspected/changed (paths);
- validation performed (commands run, observed output);
- findings/decisions;
- unresolved risks/blockers;
- remaining work;
- reusable output paths and, when supported, result refs.

Treat summaries as proposals. **Human approval stays mandatory** before a
change lands or a decision is recorded.

## Definition maintenance

- Herdr definitions live in `.pi/agents/`; Copilot workspace agents live in
  `.github/agents/`. Keep both project layers committed so teammates can use
  either runtime.
- To change a role's shared workflow, update `.github/skills/<name>/SKILL.md`.
  Update the runtime-specific profile only for instructions or capabilities
  that differ between Copilot and Herdr/Pi.
- Never edit bundled Herdr `dist/agents/` files; override via `.pi/agents/`.
- If a definition references a disabled child, it is dropped from discovery;
  keep child definitions available.

## Keeping the skill copies in sync

- The `factory-orchestrator` skill is dual-located: canonical instructions in
  `.github/skills/factory-orchestrator/SKILL.md` (GitHub Copilot), with a Pi
  mirror at `.agents/skills/factory-orchestrator/SKILL.md`.
- **Never edit the mirror independently.** The mirror only loads the canonical
  file; when you change the skill, edit `.github/skills/factory-orchestrator/SKILL.md`
  and leave the mirror untouched. Its frontmatter (`name`, `description`) must
  stay identical to the canonical file's.
- Both copies must stay committed together in the same change, and their
  `description` fields must match so both tools route the skill the same way.

## Validation checklist for the factory itself

- [ ] `scripts/factory-setup.sh --copilot` passes and the VS Code Agent
      Customizations editor lists the Copilot factory agents.
- [ ] `npm test` passes `scripts/factory-smoke.test.mjs`, and the manual
      Copilot smoke checklist above passes in the Local harness.
- [ ] Herdr `list_agents` shows the six role definitions (builder, pr-reviewer,
      qa-tester, gameplay-designer, artist, docs-writer).
- [ ] `scripts/factory-worktree.sh create <unit>` produces a sibling worktree
      on branch `factory/<unit>` with a working `npm ci`; a second agent in a
      different worktree edits the same file without conflict; `remove`
      cleans up after merge.
- [ ] A `scout` reconnaissance produces a bounded handoff.
- [ ] A `builder` change passes `npm run check`.
- [ ] A `pr-reviewer` review is read-only and returns prioritized findings.
- [ ] A `qa-tester` verification uses real commands and actual output.
- [ ] Dependent work receives the full accepted handoff; Herdr/Pi also
      forwards the prior agent's result ref.
