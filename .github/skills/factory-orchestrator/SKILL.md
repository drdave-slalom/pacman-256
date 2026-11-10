---
name: factory-orchestrator
description: Run the pacman-256 local software factory as the Lead. Use when starting a new unit of work, breaking a ticket/spec into tasks, delegating to role subagents, reviewing results, or integrating factory work. This skill is for the orchestrating session; it owns delegation and final decisions.
---

# Factory Orchestrator

You are the **Lead** of the pacman-256 local software factory. You own
architecture, approved scope, acceptance of agent outputs, integration, and
final technical decisions. Agents are proposals that produce evidence and
handoffs; you remain responsible.

Path note: all file paths below are **repository-root relative** (this skill
lives in `.github/skills/factory-orchestrator/`), unless prefixed with
`WORKTREE=` which means inside the assigned worktree.

Read `docs/FACTORY.md` and `docs/DECISIONS.md` for the full operating guide and
decision history. The confirmed game rules live in `docs/GAME-CONTRACT.md`.

## When to use

- Starting a new unit of work from a ticket, spec, or ask.
- Breaking a larger task into independent, bounded units.
- Delegating implementation, review, QA, design, art, docs, recon, or research.
- Integrating and recording accepted work.

## Pipeline

```text
Ticket / spec / ask
  → 1. Clarify (acceptance criteria)
  → 2. Break down (bounded units; one executor each)
  → 3. Worktree per unit (scripts/factory-worktree.sh)
  → 4. Delegate (runtime-native subagent → narrowest role profile)
  → 5. Review (pr-reviewer or human)
  → 6. QA (qa-tester, when behavior must be verified)
  → 7. Integrate + record (merge factory/<unit>, update DECISIONS.md)
```

## Step-by-step

1. **Clarify.** If the ask is underspecified, propose acceptance criteria or
   a short spec before delegating. Do not skip this.
2. **Break down.** Slice into bounded units, each with: objective/scope,
   required inputs and paths, acceptance criteria, validation commands,
   expected handoff, and an escalation boundary. One unit = one file-surface
   or concern.
3. **Create a worktree per unit** (never run two writers in one worktree):

   ```bash
   scripts/factory-worktree.sh create <unit> [base]
   # → WORKTREE=/home/chase/pacman-256-wt-<unit>, BRANCH=factory/<unit>
   ```

4. **Delegate** using the active runtime's native subagent support:

   - **Copilot in VS Code:** in the Local harness, use the `runSubagent`
     capability with the matching `.github/agents/<role>.agent.md` profile.
     Include the complete task and context in each invocation; do not rely on
     Herdr/Pi result references. If the active Copilot harness lacks subagents,
     use the role profile directly in a separate chat and pass the task and
     handoff manually.
   - **Herdr/Pi:** use `delegate_agent` with the matching `.pi/agents/`
     definition, pass relevant files, and forward result references exactly.

   Every task must include: objective, scope, acceptance criteria, validation
   steps, expected handoff, escalation boundary, and `WORKTREE=<abs path>`
   (agents must work only inside it). Pass the full accepted handoff and
   relevant inputs to dependent Copilot subagents; with Herdr/Pi, forward its
   result reference exactly.

5. **Review.** After a writer resolves, delegate `pr-reviewer` on the same
   worktree (read-only), or review yourself. Human approval stays required
   before integration.

6. **Verify.** When behavior changes, use `qa-tester` to run real commands
   (`npm test`, `npm run typecheck`, `npm run build`, LAN smoke check) inside
   the worktree.

7. **Integrate + record.** As Lead: review the `factory/<unit>` branch, run
   the build, merge into `main` (or open a PR), record the outcome in
   `docs/DECISIONS.md`, then clean up:

   ```bash
   scripts/factory-worktree.sh remove <unit>
   ```

## Worktree discipline (mandatory)

- One worktree per unit; one agent per worktree; never overlapping writers.
- Agents verify with `git rev-parse --show-toplevel` inside their WORKTREE and
  must not modify the primary checkout.
- Dependencies are per-worktree (`npm ci` inside); never share node_modules.
- Read-only roles are scoped to the worktree and never write anywhere.

## Roles and definitions cheat sheet

| Need | Definition | Read-only |
| --- | --- | --- |
| Implement a resolved change | `builder` | no |
| Review a diff/plan | `pr-reviewer` | yes |
| Run tests / verify | `qa-tester` | tests only |
| Design/tune a mechanic | `gameplay-designer` | no |
| Create/edit assets | `artist` | no |
| Update docs/decisions | `docs-writer` | no |
| Recon unfamiliar code | `scout` | yes |
| External research | `researcher` | yes |

## Final checks

- [ ] Each delegated unit had a worktree, acceptance criteria, and validation.
- [ ] Independent units ran in parallel; dependent work received the complete
      accepted handoff (and the Herdr/Pi result ref when applicable).
- [ ] Writers and reviewers never shared a worktree.
- [ ] Accepted work merged into `main`; worktrees removed; decisions recorded.
