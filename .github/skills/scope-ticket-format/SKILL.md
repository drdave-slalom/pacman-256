---
name: scope-ticket-format
description: >
  Canonical format for work items (stories, issues, tickets) on any tracker. Use
  whenever drafting, generating, or reviewing a work item — a single ticket or a
  full decomposition of a tech spec. Defines the ticket contract, title rules,
  section structure, AC rules, and the draft/review/create flow. Org-specific
  prefixes, roles, test commands, and reference items come from the initiative
  scoping profile. The scope-spec-to-tickets and scope-write-ticket skills load
  this one; it is not run directly.
---

# Ticket Format

The canonical structure for work items. Any stage that authors work items follows this exactly.

**Org-specific values come from `.initiative-scoping/profile.md`** — title prefixes, the layer split rule, roles, item and parent type names, test and typecheck commands, and reference items. Where the profile is silent, use the defaults stated below and never invent org conventions.

Terms: **item** is the tracker's unit of work (Story, Issue, Ticket); **parent** is its grouping (Epic, Project, Milestone). Use the profile's names in output.

***

## The Ticket Contract

Three rules govern every section below. When a section rule and one of these conflict, these win.

### 1. The ticket is the source of truth for doing the work

An engineer picking this up must be able to start **without opening anything else** — no tech spec, no parent, no chat thread.

- **Inline the specific facts**: file paths, method and type names, enum values, option lists, flag names, exact copy strings.
- **Link the spec as background, not as a substitute.** A link answers "why is it shaped this way"; it must never be load-bearing for "what do I do".
- **If a reader must open the spec to start, the ticket is incomplete.** Fix the ticket, don't add a link.
- Excerpt rather than reference: paste the three-line signature, don't write "see the Types section of the spec".

### 2. Anyone on the team can read the top of it

**Summary** and **User Story** must be comprehensible to a PM, a designer, or an engineer from another part of the codebase. No file paths, method names, or schema fields above the Acceptance Criteria.

### 3. Length is a feature

Target **~250 words** in the body. Past **~400**, the ticket is too big or padded — split it, or cut.

- **≤8 AC bullets, ≤25 words each.**
- **State each fact once.** A test named in Testing does not also appear as an AC bullet.
- Prefer a short sentence to a long bullet, and a named file to a paragraph describing it.

***

## Title

```
[PREFIX] [Milestone if applicable]: Outcome, in plain language
```

- **Prefix:** from the profile's title-prefix table, inferred from scope. If the profile defines none, omit the prefix.
- **Layer split:** if the profile defines a layer split rule (e.g. backend and frontend always separate), follow it — one item per layer, linked. If scope genuinely can't be split, stop and ask.
- **Lead with what changes, not the mechanism.** A title is read in a backlog by people who won't open it.
- Never make a bare symbol name the whole title. A symbol may appear *after* the outcome, for precision.
- Imperative voice, no trailing period.

| ✅ | ❌ |
|---|---|
| `M1: Skip the third biweekly pay cycle so the plan funds 24 times a year` | `M1: Implement skip predicate for third biweekly cycle` |
| `M3: Let admins turn on the new schedule from the funding form` | `M3: Add checkbox and wire submission paths` |
| `Record the approved amount when a claim is approved (approveClaim)` | `Update approveClaim to leverage approvedAmount` |

***

## Section Structure

Populate every **required** section. Include **optional** sections only when there is real content.

### Summary *(required)*

**1–2 sentences of plain language.** What changes, and why it matters.

- No file paths, method names, type names, or schema fields
- Name the user-visible or business-visible effect, not the code change
- If the work is invisible to users (a refactor, a guardrail), say what it protects or unblocks
- One concrete detail beats an abstraction: "funds 24 times a year instead of 26" over "adjusts payout cadence"

### User Story *(required)*

```
As a <specific role>, I want <capability>, so that <outcome>.
```

- Use a real role from the profile. Never "user" or "developer". If the profile lists none, ask.
- The `so that` clause states a benefit, not a restatement of the capability
- A second story only when the item genuinely serves two distinct moments. Never more than two
- For pure-infrastructure items with no human actor, write one sentence naming who is protected downstream and skip the template

### Acceptance Criteria *(required)*

**4–8 bullets, ≤25 words each**, each independently verifiable.

- Declarative statements of behavior, not tasks
  - ✅ `The approval sets approved_amount on the reimbursement record`
  - ❌ `Make sure approved_amount is set`
- Observable behavior, not mechanics — mechanics go in Technical Notes
- Call out backward compatibility and permission/role constraints explicitly
- **No tests here** — Testing has its own section
- More than 8 bullets means the scope is too broad — split

### Technical Notes *(required for code items)*

Everything an engineer needs to start. This is the **only** technical section.

- **Backend:** `Location: path/to/file.ext, methodName`. Call out data-model changes. State explicitly when there are NO API or signature changes
- **Frontend/Mobile:** list new files with a one-line responsibility each. Name the existing pattern or component to follow
- Inline the concrete values — enum members, flag names, i18n keys and their copy, option lists
- Point out what already exists (a helper, a query, a shared context) and **what is NOT needed**
- Name anything explicitly out of scope that a reader would otherwise open
- Call out trade-offs and constraints a developer would likely miss

### Testing *(required)*

- Name the exact test file(s) to create or update
- Give the full copy-pasteable command using the profile's **test command**, plus the **typecheck/build command** when type inference is involved. If the profile has neither, find them in the repo (package scripts, Makefile, CI config) and cite where
- State **what to assert**, not just that the suite runs
- Only the cases that earn their keep — regressions and edge cases, not the happy path for every method

### Designs *(optional — UI items only)*

Links to the relevant frame, not the top-level file, with the screen or flow named. Note if design is still in progress.

### Open Questions *(optional)*

Phrased as questions or flagged risks, with an owner when known.

### Item Links *(optional)*

Set in the tracker's link field — never duplicated in the body.

| Link | Meaning |
|---|---|
| blocked by | Can't start until the linked item is done |
| blocks | Must be done before the linked item can start |
| relates to | Context only |

Infer links from the parent's children and the spec's dependencies. Items split by the layer rule are linked `relates to`. If the tracker lacks a link type, use the closest one and say so.

### Parent

Set via the tracker's parent field — never as a mention in the body. When the parent spans milestones, include the milestone in the title.

***

## Before Presenting a Draft

- Could an engineer start **without opening the spec**? If not, inline what's missing.
- Do Summary and User Story avoid every file path, method name, and schema field?
- Does the title say what changes, rather than naming a symbol?
- Is the body under ~250 words? Any AC bullet over 25 words, or more than 8?
- Does any fact appear in two sections?

Report the word count alongside the draft.

***

## Draft Presentation Format

Before creating anything in the tracker, show the item in this format and wait for approval:

```markdown
# Draft Item

**Title:** [PREFIX] Title
**Type:** <item type>
**Parent:** <KEY> — <title> (if applicable)
**Length:** <N> words

***

## Summary
## User Story
## Acceptance Criteria
## Technical Notes
## Testing
## Designs          (omit if not applicable)
## Open Questions   (omit if not applicable)
## Item Links       (omit if not applicable)
```

Do not create the item until explicitly confirmed.

***

## Create / Output

Resolve the tracker from the profile and find the connected tool for it at run time (e.g. a Jira, Linear, or GitHub tool that creates issues). Never assume one hardcoded server name.

- **Live (default):** create the item, set the parent, return the URL.
- **Dry-run, or tracker `none`, or no tracker tool connected:** save to `<workspace>/tickets/<slug>.md`. Say which case applied.
- **Batch (`scope-spec-to-tickets`):** after plan approval, create all items in dependency order. Preserve assignee, sprint/cycle, and status on updates.

***

## Reference Examples

Use the profile's **reference items**: mirror the ones marked good, and treat any marked "do not copy" as before-examples only. If the profile lists none, follow this skill alone.
