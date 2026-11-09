---
name: scope-spec-to-tickets
description: Cut a full set of work items from a technical specification under a parent on any tracker. Decomposes the spec's milestones into items, reconciles against existing children, presents a plan for approval, then creates or updates in bulk. Run only when the user explicitly invokes scope-spec-to-tickets; don't start it from general product discussion.
---

# Spec to Tickets

Decompose a technical specification into a full set of work items under a parent. This follows spec authoring (`scope-prd-to-spec`) in the pipeline.

Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else; it covers the profile with the tracker, item and parent type names, prefixes, layer split rule, roles, and test commands. For all item formatting — contract, sections, prefixes, AC rules, draft format, and create/output — also read and follow `../scope-ticket-format/SKILL.md` (the `scope-ticket-format` skill) exactly.

## Input

```
scope-spec-to-tickets <spec-source> <parent-url-or-key> [--example <item>] [--section <milestone>] [--prefix <prefix>] [--dry-run] [--labels <a,b>]
```

- **Spec**: docs URL, local path, or workspace slug (reads `<workspace>/spec.md`) (required)
- **Parent**: parent item URL or key (required unless `--dry-run` or tracker `none`)
- **--example**: an item to mirror for heading structure and AC style
- **--section**: limit decomposition to one milestone, e.g. `M1`
- **--prefix**: override the prefix for all items — inferred per item otherwise
- **--dry-run**: save to `<workspace>/tickets/<parent-key-or-slug>-tickets.md` without touching the tracker
- **--labels**: labels to apply to every created item

## Step 1: Fetch Sources (parallel)

Find the connected tools for the tracker and docs platforms (see `scope-conventions` §5); never assume one server name.

1. **Spec** — fetch ALL content; do not truncate.
2. **Parent** — the parent and all existing children. Identify placeholders vs. real work items.
3. **Example item** (if provided) — heading structure, AC style, and level of detail to mirror.

Confirm the parsed inputs (spec title, parent key and title, child count, example) with the user before proceeding.

## Step 2: Decompose the Spec

Use the **spec's own structure as the primary guide** — its milestones, section headings, and depth reflect how the work should be chunked.

1. Walk the hierarchy: milestones → sections → subsections
2. Each substantial section or logical grouping becomes an item candidate
3. Detailed content (signatures, data-model definitions, handler logic) warrants its own item; brief mentions fold into a broader one
4. Respect dependency order: data model before services, services before API, API before UI

**Sizing:** ~1–3 days of work per item. Split large sections by sub-concern; combine trivially small ones. Testing is part of the feature item unless it's a large standalone effort.

**Layer split:** if the profile defines one, apply it — one item per layer, linked. See the `scope-ticket-format` skill.

**Reconcile against existing children:** match placeholders to spec sections by topic. Decide which to UPDATE (preserve assignee, sprint/cycle, status) vs. CREATE.

## Step 3: Draft All Items

Apply the **`scope-ticket-format` skill** to every item. When an example was provided, mirror its headings, AC style, and level of detail while still following the skill.

Each item must be **self-contained for an engineer who has not read the spec** — rule 1 of the Ticket Contract. Technical Notes carries the relevant excerpt (data model, signatures, handler logic, component list, enum values, copy), not a pointer to it.

Spec prose becomes ticket prose here — don't paste spec sections verbatim:

- **Summary and User Story are yours to write.** A spec has no user stories and its prose targets a reviewer, not an implementer. Derive the outcome from the spec's TLDR, milestone names, and the PRD it links.
- **A milestone heading is not a title.** Re-title for the outcome.
- **Trim to the item's scope.** A paragraph covering three milestones becomes the one sentence this item needs.

Open questions from the spec propagate to the relevant items.

## Step 4: Present the Plan for Approval

```markdown
# Ticket Plan

**Spec:** <title> — <source>
**Parent:** <KEY> — <title>
**Items:** <N> total (<X> update existing, <Y> create new)

## Update Existing
| Key | Current Title → Proposed Title |
|-----|--------------------------------|

## Create New
| # | Title | Prefix | Depends On |
|---|-------|--------|------------|
| 1 | M1: Store line items for each claim | <prefix> | — |
| 2 | M1: Approve or reject individual line items | <prefix> | #1 |

## Links to Create
| From | Type | To |
|------|------|----|

## Open Questions
<unresolved items from the spec that affect scope or sequencing>
```

**Wait for confirmation.** The user may approve, request changes to specific items, or switch to dry-run.

## Step 5: Execute

### Live (default)

In dependency order:

- **Updates:** preserve assignee, sprint/cycle, and status; update title, description, and content fields.
- **Creates:** set the parent; apply `--labels`.
- **Links:** create links after all items exist.

If the tracker lacks a capability (a link type, labels, a parent field), do the closest equivalent and list what was skipped in the summary.

### Dry-run

Save all drafts to `<workspace>/tickets/<parent-key-or-slug>-tickets.md` in the `scope-ticket-format` draft presentation format. Do not touch the tracker.

## Step 6: Summary

```markdown
# Summary

| # | Key | Title | Action |
|---|-----|-------|--------|
| 1 | <KEY> | M1: ... | Updated ✅ |
| 2 | <KEY> | M1: ... | Created ✅ |

**Linked:** <pairs/groups>
**Skipped (tracker limits):** <anything not applied>
**Open questions:** <items with unresolved questions>
**Blocked:** <items that are blocked and by what>
```
