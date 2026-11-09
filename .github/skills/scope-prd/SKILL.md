---
name: scope-prd
description: Write a product requirements document from an initiative's research brief and lift analysis — problem, goals, scope, requirements, phasing, and open questions — with optional publishing to the docs platform. Run only when the user explicitly invokes scope-prd; don't start it from general product discussion.
---

# Write PRD

The third stage of initiative scoping. Turn research and lift into a PRD that says **what we are building, for whom, why, and what done looks like** — and leaves *how* to the tech spec.

Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else, for the profile, workspace, evidence rules, brevity, platform resolution, and approval gates.

## Input

```
scope-prd <slug | research.md | lift.md | idea> [--publish [parent]] [--update <doc-url>] [--draft]
```

- **`<input>`** — a workspace slug (reads `research.md` and `lift.md`), one of those files, or an idea (required).
- **`--publish [parent]`** — publish to the docs platform under `parent`, or the profile's default docs parent.
- **`--update <doc-url>`** — update an existing PRD doc instead of creating one.
- **`--draft`** — publish or update as a draft or private page, where the platform supports it.

`--publish` and `--update` are mutually exclusive.

## Step 1: Load and Check Inputs

1. Load the profile and every workspace artifact available for the slug.
2. Report which stages exist. If `lift.md` is missing, warn: requirements written without a current-state check tend to re-specify shipped work. Ask whether to continue or run `scope-lift-analysis` first.
3. Pull forward: the problem, roles, findings worth citing, options, the recommended cut, dependencies, risks, and open questions.
4. If research left several options open, ask the user which one this PRD commits to. A PRD covers one option.

## Step 2: Draft the PRD

**The PRD says what and why, not how.** No file paths, schemas, or method names in the body — those live in `lift.md` and the tech spec. Link `lift.md` for the reader who wants them.

Every section is optional except TLDR, Problem, Goals, Scope, and Requirements. Target **under ~150 lines**.

```markdown
# <Initiative Name>

<date> · status: draft · owner: <name or TBD>
**Built from:** [research](./research.md) · [lift analysis](./lift.md)

## TLDR
2–3 sentences: what changes for whom, one concrete example with real values, and the business value.

## Problem
Who is blocked from doing what today, and the evidence it matters (cite findings from research, e.g. F2, F5).

## Goals and Success Metrics
| Goal | Metric | Target | How measured |
|---|---|---|---|

## Scope
**In scope:** the capabilities this PRD commits to, from the lift analysis's recommended cut.
**Out of scope:** what a reader would otherwise assume is included, each with a one-line reason.

## Users and Roles
Only roles whose experience changes, using the profile's role names. Note permission differences between roles.

## Requirements
| # | Requirement | Priority | Notes |
|---|---|---|---|
| R1 | <observable behavior, not a mechanism> | Must / Should / Could | |

## Key Flows
Step-by-step for the 1–3 flows that matter, from the role's point of view. Link designs if they exist.

## Acceptance Criteria
Per requirement or per flow; each independently verifiable. Skip when the requirements table already makes them obvious.

## Phasing
Milestones from the lift analysis's suggested sequence. Each milestone names the outcome it delivers, not the layers it touches.

## Dependencies and Risks
Only those that change scope, date, or staffing. Carry forward from lift; don't restate the full table.

## Open Questions
- [ ] <question> — owner — needed by <milestone>
```

Rules:
- **Requirements describe observable behavior.** "Admins can see the approved amount on each claim", not "add an approved_amount column".
- **Every Must traces to the problem.** If a Must can't be tied to a finding or a goal, it's a Should or it goes.
- **Scope matches the lift.** Don't commit to a capability the lift analysis sized XL without flagging that it needs its own scoping pass.
- **Sensitive data:** if any requirement touches a data class in the profile, say so in that requirement's notes.

## Step 3: Review the Draft

Before saving, check:
- Could a PM, designer, and engineer each read it and agree on what done looks like?
- Is there any file path, schema, or method name in the body?
- Is every Must traceable to the problem or a goal?
- Does Out of Scope name the things people would assume?
- Does any fact appear twice?

Fix what fails. Save to `prd.md` in the workspace and report the path, line and word count.

## Step 4: Publish (only with `--publish` or `--update`)

Resolve the docs platform (see the conventions skill). Show the user the destination, title, and whether it's a draft. **Wait for confirmation**, then create or update the page. Return the URL. If publishing fails, keep the local file and report the failure — do not retry silently.

## Step 5: Summary

```markdown
# PRD Summary

**PRD:** `<path>` (<lines> lines, <words> words) [· <published URL>]
**Built from:** research [yes/no] · lift [yes/no]
**Requirements:** <n> Must · <n> Should · <n> Could
**Milestones:** <list>
**Open questions:** <n> — <the ones blocking M1>

## Next
Resolve the questions blocking M1, then `scope-prd-to-spec <slug>`.
```
