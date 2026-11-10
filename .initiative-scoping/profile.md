# Initiative Scoping Profile

Save this as `.initiative-scoping/profile.md` in the repo you run initiative scoping from, and fill in what applies.

Every initiative scoping stage reads it before doing anything else. Anything left blank falls back to the default noted beside it. A profile is the **only** place organization-, platform-, or stack-specific facts belong — the stages themselves stay generic.

## Organization

- **Name:** pacman-256 (three-person AI workshop team; see `PROJECT-BRIEF.md`)
- **Product surfaces:** mobile-first browser game client — players on phone browsers; multiplayer room server — serves matches to the client
- **Roles:** player, hunter, runner (from `PROJECT-BRIEF.md` / `docs/GAME-CONTRACT.md`)
- **Sensitive data classes:** <!-- e.g. PII, PHI, PCI. Default: PII. -->

## Platforms

Each value names a platform; the stages find the matching connected tool at run time. Use `none` / `local` to work from files only.

- **Tracker:** github (`drdave-slalom/pacman-256`, GitHub Issues)
- **Docs:** local
- **Code host:** github
- **Work-item key pattern:** `T\d+` (factory unit IDs, e.g. `T6`)
- **Default docs parent:** <!-- page/space/folder new docs publish under. Default: ask -->

## Work-Item Conventions

- **Item type / parent type:** <!-- Default: Story / Epic -->
- **Title prefixes:**

  | Prefix | Scope |
  |---|---|
  | `T<n>:` (e.g. `T6: ...`) | Factory unit ID from `DELIVERY-PLAN.md`; one issue per unit |

- **Labels:** defined in `.github/labels.yml` (`type:*`, `role:*`, `lane:A|B|C`, `status:*`, `blocked`, `follow-up`, `playtest`); sync with `node scripts/sync-labels.mjs`.
- **Issue forms:** `.github/ISSUE_TEMPLATE/factory-unit.yml` (units), `.github/ISSUE_TEMPLATE/bug.yml` (bugs).
- **Layer split rule:** <!-- e.g. "Backend and frontend are always separate items". Default: none -->
- **Reference items:** <!-- links to items worth mirroring, and any "do not copy" examples, with one line on why -->

## Engineering Stack

- **Languages / frameworks:** TypeScript; Phaser browser client (`apps/client`); Node.js/Colyseus room server (`apps/server`); shared protocol/rules (`packages/shared`)
- **Datastore:** <!-- e.g. Postgres, DynamoDB -->
- **API style:** <!-- e.g. GraphQL, REST, gRPC -->
- **Async work:** <!-- e.g. queues, cron, cloud functions -->
- **Test command:** `npm test`
- **Typecheck / build command:** `npm run check` (typecheck + tests + build)
- **Testing guide:** `README.md`, `docs/FACTORY.md`
- **Spec section templates:** <!-- optional: how this team writes schema, API, and job changes in a spec. Paste templates here; omitted sections use neutral prose. -->

## Repositories

- **Repos in scope:** pacman-256 — this repository — client, server, shared package, factory docs and scripts
- **Architecture docs:** `AGENTS.md`, `PROJECT-BRIEF.md`, `DELIVERY-PLAN.md`, `docs/FACTORY.md`, `docs/DECISIONS.md`, `docs/GAME-CONTRACT.md`, `SPEC/`

## Output

- **Workspace root:** `docs/initiative-scoping/` — each initiative gets `docs/initiative-scoping/<slug>/`
