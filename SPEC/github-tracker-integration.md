# Spec: GitHub tracker integration (issues, labels, required CI, templates)

**Status:** Requested by David (2026-11-10) · **Type:** process/config/docs, no gameplay

## Goal

Move factory work tracking onto GitHub so units, PRs, and CI link together
automatically, and enforce the CI gate in the existing `main` ruleset.

## Scope

1. **Tracker profile.** Add `.initiative-scoping/profile.md` from the template in
   `.github/skills/scope-conventions/SKILL.md` §7, with tracker `github`, repo
   `drdave-slalom/pacman-256`, docs `local`, and workspace `docs/initiative-scoping/`.
   Ticket ID convention: factory unit IDs (`T6`…) as the title prefix.
2. **Labels.** One versioned definition (`.github/labels.yml`) plus a small,
   idempotent sync script (`scripts/sync-labels.mjs`, uses `gh label create --force`).
   Set: `type:feature`, `type:bug`, `type:chore`, `type:docs`; `role:builder`,
   `role:qa`, `role:review`, `role:design`, `role:art`, `role:docs`; `lane:A`,
   `lane:B`, `lane:C`; `status:spec`, `status:ready`, `status:in-progress`,
   `status:review`, `blocked`, `follow-up`, `playtest`. Keep GitHub defaults.
3. **Issue forms** in `.github/ISSUE_TEMPLATE/`:
   - `factory-unit.yml`: unit ID, goal, spec link, acceptance criteria,
     dependencies, lane/owner, validation; default labels `type:feature`, `status:spec`.
   - `bug.yml`: device + browser, room/player count, steps, expected, actual,
     frequency, evidence; default labels `type:bug`.
   - `config.yml`: disable blank issues; link `PROJECT-BRIEF.md` and `docs/DECISIONS.md`.
4. **PR template** `.github/pull_request_template.md` with sections required by
   FACTORY.md gate 2: linked issue (`Closes #`), spec link, QA results, review
   verdict, three-way reconciliation (spec / change / tests), follow-ups. It must
   end with the empty `<!-- auto-generated-pr-description:start -->` /
   `<!-- auto-generated-pr-description:end -->` markers so `pr-description.yml`
   fills that block without touching human sections.
5. **Required CI.** Update existing ruleset `main-copilot-review` (id 26891591)
   to require status checks `Validate (Node 22.18.0)` and `Validate (Node 24.x)`.
   No required approvals (team choice: CI only). Keep all other rules as-is.
   Do not require `generate-description` (depends on a secret / AI availability).
6. **Docs/skills.**
   - `docs/FACTORY.md`: pipeline step 0/1 starts from an issue; PRs use
     `Closes #N`; labels; deferred findings become `follow-up` issues; label sync.
   - `.github/skills/open-pr/SKILL.md`: fill the PR template, include `Closes #N`
     when an issue exists, apply `type:*`/`lane:*` labels.
   - `.github/skills/factory-orchestrator/SKILL.md`: look up or create the unit's
     issue (with user confirmation) before dispatch; link it in the spec.
   - `DELIVERY-PLAN.md`: add an Issue column for T5–T11 once issues exist.
   - `docs/DECISIONS.md`: add D055 (GitHub Issues is the tracker; CI required on
     `main`, no required approvals) only after David confirms.
   - `AGENTS.md` / `.github/copilot-instructions.md`: one concise bullet each.

## Out of scope

Projects board, review/QA evidence checks, deploy gating, Copilot coding agent,
Dependabot (separate follow-ups). No application code changes.

## External writes (each needs explicit user confirmation first)

- Running the label sync against the repo.
- Updating ruleset 26891591.
- Filing T6–T11 issues via `scope-spec-to-tickets` (T5 optional, it is in validation).

## Assumptions

- The plan table remains the overview and links to issues; issues hold per-unit detail.
- Repo admin access is available (verified: `admin: true`).
- Check names stay stable; renaming the CI matrix requires updating the ruleset.

## Acceptance criteria

- Issue forms and PR template render on GitHub (YAML validates; blank issues disabled).
- `node scripts/sync-labels.mjs` is idempotent (second run makes no changes) and
  `gh label list` shows every label in `labels.yml`.
- `gh api repos/drdave-slalom/pacman-256/rulesets/26891591` lists both required
  checks; all prior rules unchanged; a PR with failing CI cannot merge.
- A test PR shows the template, gets the auto-generated block between the
  markers, and human sections survive a re-run of `pr-description.yml`.
- Docs above are consistent with no contradictions; `npm run check` passes,
  including `scripts/factory-smoke.test.mjs`.
