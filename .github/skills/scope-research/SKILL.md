---
name: scope-research
description: Research a product problem or idea — who has it, what already exists internally, what the market and constraints look like — and write a cited research brief that seeds lift analysis and the PRD. Run only when the user explicitly invokes scope-research; don't start it from general product discussion.
---

# Product Research

The first stage of initiative scoping. Turn an idea, a question, or a stakeholder ask into a short, cited brief that says **what problem is worth solving, for whom, and what we already know** — before anyone sizes or designs anything.

Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else, for the profile, workspace, evidence rules, brevity, platform resolution, and approval gates.

## Input

```
scope-research <idea | question | doc-url | path> [--slug <name>] [--depth quick|standard|deep] [--no-web]
```

- **`<input>`** — a one-line idea, a question, a link to a stakeholder doc or ticket, or a local file (required).
- **`--slug`** — workspace name. Default: derived from the input and confirmed.
- **`--depth`** — `quick` (internal sources and a handful of external ones), `standard` (default), `deep` (one subagent per research question where your tool supports subagents, wider external sweep).
- **`--no-web`** — internal sources only.

## Step 1: Frame the Problem

1. Load the profile. If the input is a link or path, fetch it (via the docs or tracker platform, or by reading the file).
2. Write a framing and show it to the user:
   - **Problem statement** — one or two sentences, in terms of who is blocked from doing what. Not a solution.
   - **Who** — the roles affected, using the profile's role names.
   - **Research questions** — 3–6 questions whose answers would change what gets built. Drop any whose answer wouldn't.
   - **Sources planned** — which internal platforms, repos, and external domains.
   - **Slug** — the workspace name.

**Wait for confirmation.** The user will often reshape the questions; that is the point of this step.

## Step 2: Gather (parallel)

Run these in parallel. At `--depth deep`, where your tool supports subagents, give each research question its own subagent with the evidence rules in its prompt and ask for findings with sources, not prose; otherwise work through them in turn.

### 2A: Internal record
- **Docs platform** — prior PRDs, specs, research, decision records, and post-mortems in this domain.
- **Tracker** — existing epics and items in this area, especially closed or abandoned ones and why they stalled.
- **Workspace** — earlier scoping artifacts under the workspace root on related slugs.

### 2B: Codebase orientation
Just enough to know the domain: which repos, modules, and data models the problem touches. Note paths. **Do not size anything** — that is `scope-lift-analysis`'s job.

### 2C: External (unless `--no-web`)
- How others solve this — competitors, adjacent products, open-source.
- Constraints — regulation, standards, partner/vendor limits, platform policies.
- Expectations — what the affected roles commonly expect, from primary sources where possible.

Prefer primary sources. Date anything perishable.

## Step 3: Synthesize

Write `research.md` in the workspace. Use only the sections that carry information:

```markdown
# <Initiative Name> — Research

<date> · status: draft · depth: <depth>

## TLDR
3 sentences: the problem, the strongest evidence it matters, and the recommended next move.

## Problem and Who Has It
The problem in the roles' own terms, with the moments it bites. One concrete example with real values.

## Findings
| # | Finding | Source | Type |
|---|---|---|---|
| F1 | ... | <link / key / path:line> | Evidence / Inference |

## What We've Tried Before
Prior internal work, what happened, and what it means now. Omit if none.

## Landscape
How others solve it, and the one or two ideas worth stealing. Omit if `--no-web` or nothing useful.

## Constraints
Regulatory, contractual, platform, or data constraints that bound the solution.

## Options
2–4 distinct ways to frame the solution, each with who it serves best and its main risk. Not designs.

## Open Questions and Assumptions
- [ ] <question or assumption> — what would settle it — owner if known

## Recommendation
Proceed to lift analysis on option(s) X, park, or gather more evidence on Y.
```

Before saving, check: Does every finding have a source or an honest Inference tag? Does anything restate the input back to the user? Is any section padding?

## Step 4: Report

Tell the user the file path, line and word count, the number of findings by type, and the recommended next step — usually:

```
scope-lift-analysis <slug>
```
