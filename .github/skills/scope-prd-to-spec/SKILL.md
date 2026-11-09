---
name: scope-prd-to-spec
description: Turn a PRD (docs URL, local markdown, or initiative scoping workspace) into a brief, implementation-ready technical specification, with an optional plan document and docs publishing. Stack and platform specifics come from the initiative scoping profile. Run only when the user explicitly invokes scope-prd-to-spec; don't start it from general product discussion.
---

# PRD to Spec

Generate a technical specification from a Product Requirements Document. Supports the workflow PRD → Tech Spec → Plan → Docs publishing, and continues the initiative scoping pipeline (research → lift → PRD → **spec** → tickets).

Read and follow `../scope-conventions/SKILL.md` (the `scope-conventions` skill) before anything else. It loads the profile, `.initiative-scoping/profile.md`, which supplies the repos in scope, architecture-doc locations, the engineering stack and any **spec section templates**, the testing guide, sensitive data classes, the docs platform, and the work-item key pattern. Where the profile is silent, discover from the repo and say what you assumed.

## Input

```
scope-prd-to-spec <prd-url | path | slug> [--output <path>] [--publish [parent]] [--update <doc-url>] [--draft] [--plan]
```

- **`<input>`**: docs-platform PRD URL, local `.md` path, or an initiative scoping workspace slug (reads `<workspace>/prd.md`, and `lift.md` if present) (required)
- **`--output <path>`**: output directory. Default: the workspace for a slug input, else `docs/tech-specs/`
- **`--publish [parent]`**: publish to the docs platform. With a parent, create under it; without, under the PRD's page when the input was a docs URL, else the profile's default docs parent
- **`--update <url>`**: update an existing spec doc instead of creating one
- **`--draft`**: publish/update as a draft or private page, where the platform supports it
- **`--plan`**: also generate a companion plan with a milestone/story breakdown

`--publish` and `--update` are mutually exclusive.

## Step 1: Parse and Confirm

1. **Determine input type:** a URL → docs platform; a path ending `.md` → local; a bare name matching a workspace folder → slug. Otherwise stop and ask.
2. **Validate flags** as above.
3. **Confirm with the user:** input source, output path, whether a plan will be created, and whether/where publishing will occur.

**Wait for confirmation before Step 2.**

## Step 2: Load the PRD

- **Docs URL:** find the connected tool for the docs platform (see `scope-conventions` §5; never assume one server name), fetch as markdown, and keep the page and space identifiers for publishing.
- **Local or slug:** read it. For a slug, also read `lift.md` and `research.md` if present.
- **If loading fails:** report the error and STOP. Do not proceed with invented content.

Extract: title, overview and business context, requirements, acceptance criteria, phases or milestones, dependencies, open questions, referenced work items (the profile's key pattern), and design links.

## Step 3: Gather Codebase Context

### 3.0: Check the clones are current (FIRST, before any scanning)

Every "already built" and "missing" claim is only as good as the checkout it came from. Long-lived clones are routinely weeks stale, and nothing in a `grep` result says so.

For each repo in scope:

```bash
git -C <repo> log -1 --format='%h %ad %s' --date=short
git -C <repo> fetch --quiet && git -C <repo> status -sb | head -1
```

If behind, `git -C <repo> pull --ff-only` before scanning. If it can't pull cleanly, say so in the spec and treat every absence claim as provisional.

**If `lift.md` exists** and its verified SHAs match the current heads, reuse its Current State rather than re-deriving it — re-check only rows the PRD's scope added.

Record the SHAs in the spec header:

```markdown
**Verified against** <repo-a> `<sha>` and <repo-b> `<sha>` (YYYY-MM-DD).
```

The highest-severity failure this stage can produce is **asserting a shipped capability does not exist.** If the PRD refers to something as built and you can't find it, re-check the clone before contradicting the PRD.

Then **in parallel**:

### 3A: Architecture Documentation
Read the profile's architecture docs. If none are listed, discover them — e.g. `find . -name "CLAUDE.md" -maxdepth 4`, `docs/architecture/`, `ai-docs/`, ADRs — and read what's relevant to the PRD's domain.

### 3B: Relevant Code Patterns
Locate existing modules in the domain, similar features to use as pattern references, data-model definitions, API surface definitions, async jobs, and related tests.

### 3C: Referenced Work Items
For each work-item key found in the PRD, fetch it from the tracker for extra acceptance criteria and dependencies.

## Step 4: Generate the Spec

### The brevity rule (applies to every section)

**A section earns its place only if it changes the reader's actions.** The structure below is a menu, not a checklist — every top-level section is omittable. A spec one engineer can read and act on beats a complete one they skim.

- **Never restate code that isn't changing.** A path is enough. Paste a definition only when the reader must see its exact shape — most often when what a type *lacks* is the risk.
- **State each fact once.** Put it where it's most actionable; reference it elsewhere.
- **A section whose content is "nothing changes" is one sentence.**
- **Cite inline** (`path/to/file.ext:123`) rather than in an appendix.
- **If the explanation is longer than the thing it explains, cut the explanation.**

Target **under ~200 lines** for a single-parent spec. **The milestone sections should be the largest part of the document.**

***

### Opening

**Title:** the feature name only — no "Tech Spec:" prefix.

**Context links** (only real ones):

```markdown
**Product requirements:** [PRD title](url or path)
**Designs:** [link]
```

**TLDR:** 2–3 sentences — what it does in plain language, a concrete example with real values, and the business value.

***

### Current State

_Include whenever the feature touches an existing subsystem. Omit only for genuine greenfield._

```markdown
| Capability | State |
|---|---|
| <thing the feature needs> | Built — `path/to/file.ext:123` (<KEY>) |
| <thing the feature needs> | **Missing → M1** |
| <thing the feature needs> | Gated off — `path/to/flag.ext:88` |
```

Usually the highest-value section. Derive it from Step 3, not from the PRD — **a PRD's claims about what exists are not evidence.**

***

### New and Changed Types

Before the milestones, define only types that are **new or changed**:

- **New** → full definition, in the profile's language, with inline field comments.
- **Changed** → the changed fields only, marked, with one line on what moved.
- **Unchanged** → a path. Exception: paste it when its *missing* field is the risk, and say why.

Reference types by name later — never redefine them.

***

### Milestones

Break requirements into milestones (M1, M2, M3…) named for what they deliver. If the PRD defines phases, follow them.

For each milestone, include **only the subsections that apply**:

````markdown
## M1: <Milestone Name>

_Tickets will be added after milestone definition_

### Data Model Changes
New and changed tables/collections/entities, fields with types and meaning, keys and relationships, enums, indexes, and migration/backfill notes ("No backfill required" when true).

### Service / Module Changes
**New** or **updated** module → method signatures in the repo's language, then for each:
- **Input / Output**
- **Logic:** steps, edge cases, error conditions
- **Compatibility:** for changes to existing behavior

### API / Interface Changes
New or changed types and operations in the repo's API style, each with authorization.

### Async Work
New or changed jobs, consumers, or scheduled tasks — trigger, logic, error handling and retry.

### Frontend Changes
Per component/view: location, feature flag, data it reads and writes, and the user flow step by step.
````

**Use the profile's spec section templates** for any of these subsections when it provides them (e.g. a team's DDL conventions or API schema style). Otherwise write them in the native notation of the stack you found in Step 3.

***

### Implementation Patterns (if needed)

For non-obvious logic or cross-cutting concerns: decision trees, edge cases, reusable configuration.

***

### Testing

Defer to the profile's testing guide (or the one you found in the repo) — cite it, don't restate it.

```markdown
## Testing

Per <testing guide>. The cases that earn their keep:

- **<module> (unit).** <specific cases>
- **<api> (integration).** <only the non-obvious>

**AC mapping.** AC1 <criterion> → <test>. AC2 → <test>.
```

Skip the AC mapping when criteria map one-to-one onto the bullets.

***

### Security & Compliance

**Proportionate to what changes.** When nothing changes, one short paragraph covering data sensitivity, authorization, and audit — and why that's safe to say. "N/A" is not enough.

Expand only when the feature moves a sensitive data class from the profile, adds or widens a permission, changes scoping, or alters retention:

```markdown
## Security & Compliance

### Sensitive Data Handling
### Authorization
### Audit Trail
```

***

### References

**Default: none.** Add only for sources with no natural inline home — a third-party API doc, a prior incident, an RFC.

***

### Sequencing and Verification

_Include whenever there is more than one milestone._

1. **Sequencing** — which milestones are independent, which block which, and any non-obvious ordering constraint.
2. **Local verification** — how to run it and what *done* looks like: which app, flag, and screen, and the concrete observable result.

***

### Post-MVP (if applicable)

```markdown
## Post-MVP

### <Enhancement>
- Description
- Prerequisites
```

***

## Step 5: Save Locally

1. **Run the brevity check:**
   - Are the milestones the largest part? If types or references outweigh them, rewrite.
   - Is any unchanged type pasted without a stated reason?
   - Does any fact appear in more than one section?
   - Does any section say, at length, that nothing changes?

   Fix what fails. Report the final line/word count.
2. Filename: `spec.md` in a workspace; otherwise `<feature-name-kebab>-spec.md`.
3. Write to the output path, creating the directory if needed. Confirm path and size.

## Step 6: Publish or Update (optional)

Find the connected tool for the docs platform (see `scope-conventions` §5). Show the user the destination, title (`Tech Spec: <Feature Name>`), and draft status; **wait for confirmation**.

- **`--publish`:** create under the resolved parent.
- **`--update`:** fetch the existing doc for its title and version, then replace the body, keeping the title.

Return the URL. On failure, keep the local file and give manual paste instructions.

## Step 7: Plan Document (optional — `--plan`)

Write `plan.md` next to the spec:

```markdown
# <Feature Name> Plan

## Business Context
## Success Criteria
## Out of Scope

***

## <Parent> 1 — M1: <Milestone Name>

### Story 1.1: <Name>
<2–3 sentences>

**Acceptance Criteria:**
- [ ] ...

***

## Open Questions
- [ ] <question> — Owner: <name or TBD>

## Critical Files
- `path/to/file.ext` — why it matters
```

Number stories within each milestone (1.1, 1.2 … 2.1). Each story maps to one milestone subsection. Tell the user the plan can be cut into items with `scope-spec-to-tickets` or `scope-write-ticket`.

## Step 8: Summary

```markdown
# Tech Spec Summary

**PRD:** <title>
**Spec:** `<path>` (<size>)

## Structure
- Milestones: <names>
- Subsections per milestone: <list>

## Published
<URL, or "Not published — use --publish or --update">

## Plan
<path, or "Not created — use --plan">

## Next Steps
1. Review the spec and adjust
2. Link the spec from the PRD
3. `scope-spec-to-tickets <spec> <parent>` to cut the items
4. Add item keys to the milestone sections
```
