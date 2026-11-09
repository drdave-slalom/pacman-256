---
name: scope-conventions
description: >
  Shared rules for every initiative scoping stage: loading the scoping profile,
  the per-initiative workspace, evidence and citation standards, the brevity rule,
  resolving tracker and docs platforms at run time, and approval gates. The stage
  skills (scope-research, scope-lift-analysis, scope-prd, scope-prd-to-spec,
  scope-spec-to-tickets, scope-write-ticket) load this one; it is not run directly.
---

# Initiative Scoping Conventions

Rules every initiative scoping stage follows. When a stage's own step and one of these conflict, these win.

The pipeline is **research → lift analysis → PRD → tech spec → tickets**. Each stage writes one artifact and reads the ones before it, so the chain stays traceable.

***

## 1. Load the Profile First

Before any other step, read `.initiative-scoping/profile.md` from the current repo.

- **Found:** use it for roles, platforms, repos, stack, and output paths. Do not ask the user for anything the profile answers.
- **Not found:** proceed with defaults (docs `local`, tracker `none`, workspace `docs/initiative-scoping/`). Tell the user once that no profile was found, and offer to create `.initiative-scoping/profile.md` from the Profile Template in §7. Create it only if they say yes, and don't hold the stage waiting for it.

Never hardcode an organization's names, prefixes, roles, or stack into an artifact. If a fact is org-specific and not in the profile, ask — don't guess.

***

## 2. One Workspace per Initiative

Each initiative lives in `<workspace-root>/<slug>/`, default `docs/initiative-scoping/<slug>/`:

| File | Written by | Read by |
|---|---|---|
| `research.md` | `scope-research` | `scope-lift-analysis`, `scope-prd` |
| `lift.md` | `scope-lift-analysis` | `scope-prd`, `scope-prd-to-spec` |
| `prd.md` | `scope-prd` | `scope-prd-to-spec` |
| `spec.md`, `plan.md` | `scope-prd-to-spec` | `scope-spec-to-tickets`, `scope-write-ticket` |
| `tickets/*.md` | `scope-spec-to-tickets`, `scope-write-ticket` (dry-run or no tracker) | — |

- `<slug>` is the initiative name in kebab-case. Confirm it at the first stage; later stages accept the slug as their input.
- Every artifact opens with a short header: title, date, status (`draft` / `reviewed`), and links to the artifacts it was built from.
- A later stage **reads the earlier artifacts in full** before starting. If a stage it depends on is missing, say so and ask whether to continue without it.
- Re-running a stage overwrites its artifact. Show the user what changed in a few bullets.

***

## 3. Evidence Rules

Scoping is only useful if the reader can tell what is known from what is guessed.

- **Tag every non-obvious claim** as one of:
  - **Evidence** — cite it: a URL, a doc, a work-item key, or `path/to/file.ext:123`.
  - **Inference** — reasoned from evidence; say from what.
  - **Assumption** — unverified. Each one goes in Open Questions with what would confirm it.
- **A document's claims about what exists are not evidence.** A PRD, a research note, or a Slack thread saying a capability shipped is a prompt to check the code, not proof.
- **Absence is evidence only against a current checkout.** Before claiming something does not exist, run the freshness check:
  ```bash
  git -C <repo> log -1 --format='%h %ad %s' --date=short
  git -C <repo> fetch --quiet && git -C <repo> status -sb | head -1
  ```
  If behind, `git -C <repo> pull --ff-only`. If it cannot pull cleanly, mark every absence claim as provisional. Record the verified SHAs in the artifact header.
- **External sources:** prefer primary sources (vendor docs, regulations, standards, first-party data) over summaries. Date anything that can go stale (prices, market share, regulatory status).
- **Never invent content to fill a failed fetch.** Report the failure and continue without it.

***

## 4. The Brevity Rule

**A section earns its place only if it changes the reader's decision or actions.** Every template section is a menu item, not a requirement.

- State each fact once, where it is most useful; refer to it elsewhere.
- Cite inline at the point of need rather than in an appendix.
- A section whose content is "nothing here" is one sentence or nothing.
- Report the final line and word count when saving, so the cost is visible.

***

## 5. Resolving Platforms

Stages describe what they need ("search the docs platform", "list work items under a parent"); the profile names the platform. Resolve the tool at run time:

1. Find the connected tool (MCP server or connector) for the platform and action — e.g. Jira search, Confluence create page, Notion create page, Linear list issues. In Claude Code, find these with `ToolSearch`.
2. Several servers may expose the same platform under different names. Use whichever is connected and authenticated. **Never assume a single hardcoded server name.**
3. If no matching tool is connected, fall back to local files for that step, tell the user, and continue. A missing integration narrows the research; it never justifies fabricated content.
4. Code host: prefer the host's CLI (`gh`, `glab`) when installed and authenticated.

***

## 6. Approval Gates

- **Confirm scope before heavy work** — the framing, slug, and sources at the start of each stage.
- **Confirm before any external write** — publishing a doc or touching the tracker. Show the destination and a summary; wait for an explicit yes.
- Local files in the workspace can be written without a gate.

***

## 7. Profile Template

What to write to `.initiative-scoping/profile.md` when the user asks for it. Fill in only what the user tells you; leave the rest blank.

````markdown
# Initiative Scoping Profile

Save this as `.initiative-scoping/profile.md` in the repo you run initiative scoping from, and fill in what applies.

Every initiative scoping stage reads it before doing anything else. Anything left blank falls back to the default noted beside it. A profile is the **only** place organization-, platform-, or stack-specific facts belong — the stages themselves stay generic.

## Organization

- **Name:** <!-- e.g. Acme Health -->
- **Product surfaces:** <!-- one line each: name — who uses it -->
- **Roles:** <!-- real roles used in user stories, e.g. "benefits administrator", "member". Default: ask the user. Never "user". -->
- **Sensitive data classes:** <!-- e.g. PII, PHI, PCI. Default: PII. -->

## Platforms

Each value names a platform; the stages find the matching connected tool at run time. Use `none` / `local` to work from files only.

- **Tracker:** <!-- jira | linear | github | azure-boards | none. Default: none -->
- **Docs:** <!-- confluence | notion | google-docs | local. Default: local -->
- **Code host:** <!-- github | gitlab | bitbucket. Default: github -->
- **Work-item key pattern:** <!-- regex, e.g. [A-Z]{3,}-\d+ . Default: [A-Z][A-Z0-9]+-\d+ -->
- **Default docs parent:** <!-- page/space/folder new docs publish under. Default: ask -->

## Work-Item Conventions

- **Item type / parent type:** <!-- Default: Story / Epic -->
- **Title prefixes:** <!-- table of prefix → scope. Default: no prefixes -->
- **Layer split rule:** <!-- e.g. "Backend and frontend are always separate items". Default: none -->
- **Reference items:** <!-- links to items worth mirroring, and any "do not copy" examples, with one line on why -->

## Engineering Stack

- **Languages / frameworks:** 
- **Datastore:** <!-- e.g. Postgres, DynamoDB -->
- **API style:** <!-- e.g. GraphQL, REST, gRPC -->
- **Async work:** <!-- e.g. queues, cron, cloud functions -->
- **Test command:** <!-- e.g. npm run test:unit -- <pattern> -->
- **Typecheck / build command:** 
- **Testing guide:** <!-- path or URL -->
- **Spec section templates:** <!-- optional: how this team writes schema, API, and job changes in a spec. Paste templates here; omitted sections use neutral prose. -->

## Repositories

- **Repos in scope:** <!-- name — local path — what lives there -->
- **Architecture docs:** <!-- e.g. CLAUDE.md files, ai-docs/, docs/architecture/. Default: discover -->

## Output

- **Workspace root:** <!-- Default: docs/initiative-scoping/ — each initiative gets docs/initiative-scoping/<slug>/ -->
````
