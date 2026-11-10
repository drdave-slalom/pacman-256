# M0 spec: factory-control snapshot core

**Status:** Draft — not approved; do not implement until the Lead approves and a
ticket is assigned. · **Workstream:** pacman-256 factory control center (M0)
**Sources:** [brainstorm](factory-control-brainstorm.md), [factory guide](../../docs/FACTORY.md),
[decision log](../../docs/DECISIONS.md).

## Goal

A `factory-control/server` process aggregates everything the factory already
produces into one **snapshot** that both the web mirror (M1) and the TUI (M3)
render. It is the single source of truth for “what is happening in the factory”:
units flowing through pipeline stages (pure inference), live herd/agent state,
git worktree/branch facts, and GitHub PR/CI status. It exposes a read-only HTTP
API and a CLI, with smoke tests locking the read path.

Unit identity and stage are **inferred only** (decision 4): no manual status tags
are added to SPEC files.

## Out of scope (for M0)

- Web UI (M1), mutations/actions (M2), TUI (M3), triggers (M4).
- Writing to Herdr state, git, or GitHub.
- Auth beyond the local server trust boundary; secrets.

## Assumptions

- Herdr on-disk state lives under `~/.pi/agent/pi-herdsman/` and is an
  **internal, versioned implementation detail**. Reads are defensive: missing,
  malformed, or unreadable inputs render as `unknown`/omitted — never a crash.
- `gh` CLI is the GitHub interface (already the factory's tool); if `gh` is not
  authenticated/installed, GitHub-derived fields are `unavailable` (not an
  error).
- The factory's unit vocabulary is: a SPEC markdown file in the repo
  (`SPEC/*.md`), an optional `factory/<unit>` git branch, an optional worktree,
  agent handoffs, and an optional PR. These are joined by **normalized identity
  matching** (see below) — exact 1:1 naming is not assumed.
- Polling is fine (snapshot freshness ~5 s, cached), and the server re-reads on
  each refresh; filesystem watchers are optional.
- Node ≥22, TypeScript, minimal dependencies (hono or `node:http`).

## Data sources and read rules

| Source | Read | Defensive rule |
| --- | --- | --- |
| `SPEC/*.md` (repo) | title (first H1), slug, first paragraph (goal), any lane markers | unreadable → unit still listed with `parseError` |
| `git worktree list --porcelain` | worktree path + branch per checkout | command failure → `gitUnavailable` |
| `git branch --list 'factory/*'` + `git for-each-ref refs/remotes/origin/factory/*` | local + remote branch existence (deduplicated) | same |
| `git diff main...<branch> --numstat` (cached) | per-branch net +add/-del, changed-file count | base/ancestry unavailable → omit totals |
| `git status --porcelain` (worktree) | dirty flag | same |
| Herdr `runtime/mailboxes-v5` | live agent records (label, definition, state, available tools) | empty when idle; per-record parse failure → that record `unknown` |
| Herdr `results/` | agent handoffs: parse the leading `Agent result source: {...}` JSON (agent label, definition, session id) + handoff text | per-file parse failure → row `unknown` retained |
| Herdr `result-ref-reservations/` | unit-labeled subdirs (e.g. `t4-review/1`) — auxiliary mapping aid | optional |
| `gh pr list --state all --json number,title,state,headRefName,...` | PRs by head branch | gh unavailable → `unavailable` |
| `gh pr checks <pr>` | per-check state | per-PR failure → `unknown` |

### Normalized identity

- `canonicalId(s) = lowercase(s)` with non-alphanumerics collapsed (`-`, `_`,
  space, case). Example: SPEC file `T3-private-rooms-and-synchronized-movement.md`
  → `t3privateroomsandsynchronizedmovement`; branch `factory/t4-mobile-lobby` →
  `t4mobilelobby`.
- Matching (implemented): a branch/worktree/PR/handoff joins a unit by score =
  containment (dominant, ~5000) plus a token-overlap term (~1000 + shared
  length) for shared normalized tokens. The `factory` namespace token is
  excluded from overlap. Highest non-zero score wins; ties resolve
  deterministically. Unmatched artifacts go to an `orphaned` bucket surfaced in
  the UI (honest pure inference). Known limitation: generic shared tokens
  (`control`, `web`, `review`, `ui`, `docs`, `spec`) can create ambiguity;
  adversarial cases are covered by matching tests.
- Handoffs join via their `agent` label canonical id against the same rule;
  unmatched handoffs → `orphaned`.

## Snapshot schema (TypeScript)

```ts
type Lifecycle = "working" | "blocked" | "settling" | "starting"
               | "idle" | "done" | "unknown" | "lost";

interface AgentRecord {
  label: string; definition: string; state: Lifecycle;
  elapsedMs?: number; model?: string; thinking?: boolean; contextPct?: number;
  stale?: boolean; inactiveMs?: number; lastActivityAt?: string;
  availableTools: string[];            // display-only
  source: "mailbox" | "result" | "unknown";
}

type Stage = "spec" | "dispatch" | "execute" | "review" | "qa"
           | "integrate" | "ci" | "done" | "unknown";

interface Unit {
  id: string;                          // canonicalId
  specPath?: string; title?: string; goal?: string; lane?: string;
  parseError?: string;
  stage: Stage;
  flags: UnitFlags;
  branch?: string; worktree?: {
    path: string; dirty: boolean;
    diff?: { add: number; del: number; files: number };
  };
  agents: AgentRecord[];               // currently acting on this unit
  handoffs: HandoffRef[];              // durable trail
  pr?: { number: number; state: string; checks: CheckState; url: string };
  attention: Attention[];
}

interface UnitFlags {
  reviewPending: boolean; qaPending: boolean; ciRed: boolean;
  readyToMerge: boolean; readyForCleanup: boolean; needsDispatch: boolean;
  blockedAgent: boolean;
}

type CheckState = "green" | "red" | "pending" | "none" | "unavailable" | "unknown";
type Attention =
  | "blocked-agent" | "review-pending" | "qa-pending" | "ci-red"
  | "ready-to-merge" | "ready-for-cleanup" | "needs-dispatch"
  | "orphaned-artifacts" | "parse-error";
```

`FactorySnapshot` = `{ generatedAt, repo: { root, branch, dirty }, units: Unit[], agents: AgentRecord[], prs: PullRequest[], orphaned: { branches: string[]; worktrees: string[]; handoffs: string[]; prs: string[] }, errors: string[] }`.

The `orphaned` field lists artifacts that could not be joined to a unit (see
Normalized identity); it is always surfaced, never dropped silently.

## Pure-inference stage decision

For each unit `U`, collect evidence `E = (W, B, I, R, Q, P, C, M)`:

- `W` worktree exists for `U`; `B` branch exists; `I` implementation handoff
  present (definition in {builder, implementer, generalist}); `R` review handoff
  present (`pr-reviewer`); `Q` QA handoff present (`qa-tester`);
- `P` open PR for `U` (head branch matches); `C` its checks state; `M` PR
  merged (`state == "MERGED"`).

Primary stage (first match wins, evaluated top-down):

1. `M` (PR merged) → **done**; `readyForCleanup` if `W` or `B` still exists.
2. `P` and `C == green` → **integrate** (`readyToMerge = true`).
3. `P` → **integrate** (`ciRed = C == "red"`).
4. `W`/`B` and `I` and `R` and `Q` → **integrate** (awaiting PR; flags
   `reviewPending/qaPending` false).
5. `W`/`B` and `I` and `R` and not `Q` → **qa** (`qaPending = true`).
6. `W`/`B` and `I` and not `R` → **review** (`reviewPending = true`).
7. `W`/`B` and not `I` and a live agent is acting on `U` → **execute**.
8. `W`/`B` → **dispatch**.
9. SPEC exists with no `W`/`B` → **spec** (`needsDispatch = true`).
10. Otherwise → **unknown**.

Attention flags derive from the stage + agent states (`blockedAgent` if any agent
on `U` is blocked). Review and QA may run concurrently; the primary stage still
places the card (step 4–6 order reflects review-first, QA-alongside; a unit with
both pending shows primary `review` and both flags).

## HTTP API (read-only)

- `GET /api/snapshot` → `FactorySnapshot` (cached ≤5 s; `Cache-Control: no-store`).
- `GET /api/healthz` → `{"ok":true,"snapshotAt":...}`.
- `POST /api/refresh` → force refresh then return snapshot.
- Any other method/path → `404`; no mutation endpoints exist in M0.

## CLI

`npm run factory:control -- snapshot [--json]` prints the snapshot (default human
summary; `--json` raw). Used by smoke tests and manual checks. Flags:
`--root <path>` (default repo root), `--no-gh` (skip GitHub reads).

## Tests / validation

- Unit tests: `canonicalId` and matching rules; inference decision table
  (each rule with synthetic evidence fixtures); defensive parse of malformed
  result/mailbox files.
- Integration (fixture): run against a synthetic temp repo (SPEC files, branches,
  fake worktree list, fixture `results/`) → assert stage assignment and flags; no
  crash on missing dirs.
- Live smoke: against the real repo, `npm run factory:control -- snapshot --json`
  exits 0, emits valid JSON, lists ≥1 unit per existing SPEC file, and does not
  error when `gh` is unavailable (fields `unavailable`).
- `npm run check` (typecheck + tests + build) passes with the new workspaces
  wired.

## Acceptance criteria

1. Snapshot parses every existing `SPEC/*.md` into a unit without manual tags.
2. Stage assignment follows the decision table; `unknown` only when no rule
   matches; orphaned artifacts are surfaced, never dropped silently.
3. Live agents appear with correct lifecycle vocabulary; results render as a
   durable per-unit trail with session metadata.
4. `gh` absence degrades to `unavailable` fields; unreadable Herdr files degrade
   to `unknown` rows; no crash in either case.
5. `/api/snapshot` returns fresh JSON; `--json` CLI matches.
6. Read-only enforced: there is no mutation endpoint in M0.

## Handoff

Builder reports: files changed (server, workspace wiring), schema/API as built,
any deviation from pure inference (with reason), commands run with results
(`factory:control snapshot`), test coverage, and the three-way reconciliation
(spec ↔ change ↔ tests). Escalate before adding mutation endpoints, changing the
snapshot schema incompatibly, or touching Herdr state directories.
