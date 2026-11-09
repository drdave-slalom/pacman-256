---
name: scope-lift-analysis
description: Measure the lift to deliver an initiative — what the codebase already does, what is missing, how big each gap is, and what could block it — producing a cited current-state and sizing analysis that grounds the PRD. Run only when the user explicitly invokes scope-lift-analysis; don't start it from general product discussion.
---

# Lift Analysis

The second stage of initiative scoping. Answer **"how far are we from this?"** with evidence from the code, so the PRD scopes against reality instead of assumption. Its most valuable output is usually discovering that part of the work is already behind you.

Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else, for the profile, workspace, evidence rules, brevity, platform resolution, and approval gates.

## Input

```
scope-lift-analysis <slug | research.md | idea | doc-url> [--repos <a,b>] [--option <name>]
```

- **`<input>`** — a workspace slug (reads `research.md`), a path, a doc link, or a one-line idea (required).
- **`--repos`** — limit the scan to these repos. Default: the profile's repos in scope, narrowed by the research brief.
- **`--option`** — when the research lists several options, analyze only this one. Default: all options the research recommends.

## Step 1: Derive the Capability List

1. Load the profile and the input. If a slug was given, read `research.md` in full; if it's missing, warn and continue from the input alone.
2. List the **capabilities** the solution needs — things the system must be able to do, phrased without implementation ("record an approved amount per claim", "notify a member when funds land"). Usually 5–15.
3. Show the user the capability list and the repos you will scan. **Wait for confirmation** — a missing capability here becomes a missing milestone later.

## Step 2: Freshness Check

Run the freshness check from the conventions skill on every repo in scope **before scanning**. Record the SHAs. Do not skip this: a stale clone turns "already built" into "missing" and inflates the lift.

## Step 3: Scan per Capability

For each capability, find what exists. Run independent capabilities in parallel; where your tool supports subagents, use them for large repos; otherwise work through capabilities in turn.

- Search for the domain nouns and verbs, the data model, API surfaces, jobs, and UI entry points.
- Check feature flags and config — a capability can exist but be **gated off**.
- Read enough of each hit to know whether it really does the job, or just shares a name.

Classify each:

| State | Meaning |
|---|---|
| **Built** | Does what's needed today. Cite it. |
| **Partial** | Exists but needs extending — say what's missing. |
| **Gated** | Built but behind a flag, config, or plan tier. |
| **Missing** | Not found in current checkouts. Say where you looked. |

If a source document claims something is built and you can't find it, re-check freshness, then say so plainly with where you looked.

## Step 4: Size the Gaps

Size each Partial and Missing capability:

| Size | Rough meaning |
|---|---|
| **S** | ≤2 days for one engineer, existing patterns |
| **M** | ≤1 week, maybe a new module or migration |
| **L** | Multi-week or multi-engineer; touches several layers |
| **XL** | Needs its own scoping pass before it can be sized |

Give each size a confidence (high / medium / low) and the one-line reason. Then identify:

- **Reuse** — existing helpers, patterns, or services the work should build on.
- **Dependencies** — other teams, vendors, data, or approvals the work waits on.
- **Risks** — data migration, backfill, sensitive data (per the profile's data classes), performance, permissions, irreversible changes.
- **Build / extend / buy** — only where a real alternative to building exists.

## Step 5: Write `lift.md`

```markdown
# <Initiative Name> — Lift Analysis

<date> · status: draft · built from: [research.md](./research.md)
**Verified against** <repo> `<sha>`, <repo> `<sha>` (<date>).

## TLDR
2–3 sentences: overall lift (e.g. "About half is built; two M-sized gaps and one L"), the biggest risk, and the recommended MVP cut.

## Current State
| Capability | State | Where / Gap | Size |
|---|---|---|---|
| <capability> | Built | `path/to/file.ext:123` | — |
| <capability> | Partial | `path:line` — lacks X | M (med) |
| <capability> | Missing | looked in `a/`, `b/` | L (low) |

## Dependencies and Risks
Only the ones that change scope, order, or staffing.

## Options Compared
Omit when there is one option. Otherwise: option → total lift → what it gives up.

## Recommended Cut
- **MVP:** capabilities that deliver the core outcome.
- **Later:** what waits, and why it's safe to wait.
- **Suggested sequence:** what unblocks what.

## Open Questions
- [ ] <question> — why it matters for sizing — owner
```

The Current State table should be the largest part of the document. If prose outweighs it, cut prose.

## Step 6: Report

Tell the user the file path, line and word count, the counts by state (Built / Partial / Gated / Missing), the total lift in one line, and the next step:

```
scope-prd <slug>
```
