---
name: scope-write-ticket
description: Write a single work item on any tracker following the scope-ticket-format standard. Takes a description and optional parent/spec context, drafts the item for review, then creates it. Run only when the user explicitly invokes scope-write-ticket; don't start it from general product discussion.
---

# Write Ticket

Write a single work item. Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else; it covers the profile with the tracker, prefixes, roles, and test commands. For the format — contract, title and prefix rules, sections, draft presentation, and create/output — also read and follow `../scope-ticket-format/SKILL.md` (the `scope-ticket-format` skill) exactly.

## Input

```
scope-write-ticket "<description>" [--parent <url-or-key>] [--spec <url-or-path>] [--prefix <prefix>] [--dry-run]
```

- **Description**: what needs to be done (required)
- **--parent**: parent item URL or key (optional but strongly recommended)
- **--spec**: tech spec doc URL or local path (optional)
- **--prefix**: title prefix from the profile — inferred from scope if omitted
- **--dry-run**: save locally without creating in the tracker

## Step 1: Gather Context (parallel)

Find the connected tools for the tracker and docs platforms (see `scope-conventions` §5); never assume one server name. Fetch all provided inputs at once:

1. **Parent** (if provided) — milestone label, domain context, and existing children, so you don't duplicate work already ticketed.
2. **Tech spec** (if provided) — docs platform or reading the file. Extract the implementation details, paths, and data model relevant to this item.
3. **Description** — parse scope; infer the prefix from the profile if not provided.

If the work spans the layers the profile's split rule separates, **stop and ask** whether to split.

## Step 2: Draft, Review, and Create

Apply the **`scope-ticket-format` skill** for the title, every section, the draft presentation and approval gate, and create vs. dry-run output.
