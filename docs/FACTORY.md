# Local Software Factory

This is the operating guide for the **local, agent-powered software factory**
for pacman-256. It defines how we break work into bounded units and distribute
it across role-specific subagents running locally in **Herdr** (Pi Herdsman),
with a human Lead owning acceptance and integration.

**Lead sessions should load the `factory-orchestrator` skill** to run this
workflow; it is the executable form of this guide. The skill is dual-located:

- Canonical instructions: `.github/skills/factory-orchestrator/SKILL.md`
  (loaded by GitHub Copilot; the single source of truth).
- Pi mirror: `.agents/skills/factory-orchestrator/SKILL.md` (loads the
  canonical file, so the two never drift).

The factory is a *process*, not a machine: agents are proposals that produce
evidence and handoffs; people stay responsible. It complements the GitHub
Actions CI (which validates pushed code) by doing the per-task work locally:
spec/breakdown → implementation → review → QA → integration.

## Roles (Herdr definitions)

All factory roles are defined as project-local Herdr agents in
`.pi/agents/`. They inherit project context (`AGENTS.md`, brief, contract) and
load the matching skill from `.github/skills/`.

| Definition | Project skill | Typical assignment | Read-only? |
| --- | --- | --- | --- |
| `builder` | `builder` | Implement a resolved change; build/test/package; fix build pipeline | no |
| `pr-reviewer` | `pr-reviewer` | Independently review a diff/PR/plan | **yes** |
| `qa-tester` | `qa-tester` | Run tests/probes, reproduce bugs, verify fixes | no (tests only) |
| `gameplay-designer` | `gameplay-designer` | Design/tune a mechanic; write short spec or constant changes | no |
| `artist` | `artist` | Create/edit original sprites, tiles, UI, audio | no |
| `docs-writer` | `docs-writer` | Update README/docs/decision log | no |
| `scout` | (bundled) | Read-only reconnaissance of unfamiliar code | **yes** |
| `researcher` | (bundled) | External/authoritative research | **yes** |

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
3. Dispatch  → delegate_agent to the narrowest capable definition,
      │          passing relevant files + result refs
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

Stages 3–6 can run concurrently for **independent** units; dependencies are
passed as result refs through `files` (e.g. gameplay-designer spec →
builder implementation → pr-reviewer review).

## Worktree isolation

Each concurrent agent gets its **own git worktree** so parallel agents never
write to the same files or the primary checkout. Herdr does not do this
automatically; the Lead does it with `scripts/factory-worktree.sh`.

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
- **Reuse evidence, don't duplicate it.** Pass completed-Agent result refs
  exactly (e.g. `result:agent#3`) via `files` to dependent work.
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
   delegate_agent
     definition: builder
     task: Implement T5 countdown + baseline contact elimination per the
           approved contract. WORKTREE=/home/chase/pacman-256-wt-t5-countdown;
           do all edits and commands inside that worktree only.
           Acceptance = authoritative round completes with tests for
           timeout/simultaneous-elimination/disconnect; run npm run check there.
     files: [docs/GAME-CONTRACT.md, docs/DECISIONS.md]
   ```

4. When it resolves, forward its result ref to the reviewer (same worktree):

   ```text
   delegate_agent
     definition: pr-reviewer
     task: Review the T5 implementation in
           WORKTREE=/home/chase/pacman-256-wt-t5-countdown for contract
           compliance, mobile usability, multiplayer edge cases, regressions.
           Read-only.
     files: [result:<builder result ref>]
   ```

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
- reusable output paths/result refs.

Treat summaries as proposals. **Human approval stays mandatory** before a
change lands or a decision is recorded.

## Definition maintenance

- Factory definitions live in `.pi/agents/` (project layer) and are committed
  so all teammates share them. They overlay bundled definitions by `name`.
- To change a role: edit the matching `.pi/agents/<name>.md` (frontmatter
  capabilities + body guidance). Refresh with `list_agents`.
- Never edit bundled `dist/agents/` files; override via project layer.
- If a definition references a disabled child, it is dropped from discovery;
  keep child definitions available.

## Validation checklist for the factory itself

- [ ] `list_agents` shows the six role definitions (builder, pr-reviewer,
      qa-tester, gameplay-designer, artist, docs-writer).
- [ ] `scripts/factory-worktree.sh create <unit>` produces a sibling worktree
      on branch `factory/<unit>` with a working `npm ci`; a second agent in a
      different worktree edits the same file without conflict; `remove`
      cleans up after merge.
- [ ] A `scout` reconnaissance produces a bounded handoff.
- [ ] A `builder` change passes `npm run check`.
- [ ] A `pr-reviewer` review is read-only and returns prioritized findings.
- [ ] A `qa-tester` verification uses real commands and actual output.
- [ ] Dependent work receives the prior agent's result ref, not a summary.
