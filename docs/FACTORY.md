# Local Software Factory

This is the operating guide for the **local, agent-powered software factory**
for pacman-256. It defines how we break work into bounded units and distribute
them across role-specific subagents, with a human Lead owning acceptance and
integration. The factory supports GitHub Copilot in VS Code and the original
Herdr (Pi Herdsman) runtime.

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
spec/breakdown → implementation → review → QA → integration.

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
Ticket / spec / ask
      │  (Lead)
      ▼
1. Clarify → proposed acceptance criteria (short spec if needed)
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
5. Review    → independent pr-reviewer (or human) on the diff/result
      │
      ▼
6. QA       → qa-tester verifies behavior with real commands
      │
      ▼
7. Integrate → Lead accepts, integrates, records decisions, closes the unit
```

Stages 3–6 can run concurrently for **independent** units. Keep dependent work
sequential and provide the next agent with the complete accepted handoff and
relevant inputs.

### Copilot in VS Code

Use the `factory-orchestrator` skill or the `factory-orchestrator` workspace
agent in `.github/agents/`. In VS Code's Local harness, enable **Run Subagent**
and ask the orchestrator to dispatch with the matching role profile. Give each
subagent a self-contained task with its worktree path, allowed scope,
acceptance criteria, validation commands, expected handoff, and escalation
boundary. Local subagents do not use Herdr/Pi `files` or result references;
include the necessary context and accepted handoff text directly. If the
selected Copilot harness does not support subagents, select the role profile
directly in a separate chat and pass the same self-contained task and handoff
manually.

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
  worktree; do not run two agents in the same worktree.
- **Read-only roles** (pr-reviewer, scout, researcher) are scoped to the
  worktree path but never write anywhere.
- **Dependencies are per-worktree** (`npm ci` inside the worktree). Never share
  node_modules across worktrees.
- **Integrate after acceptance:** review the `factory/<unit>` branch, merge it
  into `main` (or open a PR), then remove the worktree:

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
  local-network smoke test). Cloud/CI work is separate and deferred.

## Dispatch example

From a Lead session:

1. Break the ticket into units (one per file-surface/concern).
2. For each unit, create its isolated worktree:

   ```bash
   scripts/factory-worktree.sh create t5-countdown
   ```

3. Delegate the unit, naming its worktree:

   ```text
   Copilot subagent: builder (VS Code Local harness)
     task: Implement T5 countdown + baseline contact elimination per the
           approved contract. WORKTREE=/home/chase/pacman-256-wt-t5-countdown;
           do all edits and commands inside that worktree only.
           Acceptance = authoritative round completes with tests for
           timeout/simultaneous-elimination/disconnect; run npm run check there.
     context: docs/GAME-CONTRACT.md, docs/DECISIONS.md
   ```

4. When it resolves, pass its complete handoff to the reviewer (same worktree):

   ```text
   Copilot subagent: pr-reviewer
     task: Review the T5 implementation in
           WORKTREE=/home/chase/pacman-256-wt-t5-countdown for contract
           compliance, mobile usability, multiplayer edge cases, regressions.
           Read-only.
     context: builder's complete handoff and the worktree diff
   ```

For Herdr/Pi, replace “Copilot subagent” with `delegate_agent`, use the
matching `.pi/agents/` definition, and pass the result reference in `files`.

5. Integrate accepted work: merge `factory/t5-countdown` into `main` (or open a
   PR), run the build, record in `docs/DECISIONS.md`, then run
   `scripts/factory-worktree.sh remove t5-countdown`.

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
