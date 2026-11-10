# Draft Item

**Title:** M0: Give the control center one live snapshot of all factory work
**Type:** Ticket
**Parent:** Factory control center (M0–M4)
**Length:** 330 words

## Summary

Build the core data service for the factory control center: one server that
reads the factory's real state — specs, git branches and worktrees, Herdr agent
handoffs, GitHub PRs and checks — and serves it as a single JSON snapshot. Every
other part (web board, terminal screen, actions) builds on this snapshot.

## User Story

As the factory Lead, I want one always-fresh view of every unit's stage and
state, so that the team can see what is happening without opening five tools.

## Acceptance Criteria

1. A SPEC file in the repo appears as a unit in the snapshot.
2. Each unit gets an inferred stage from the decision table; unknown only when no
   rule matches.
3. Orphaned artifacts surface in their own bucket, never silently dropped.
4. Live agents appear with Herdr lifecycle vocabulary; finished handoffs form
   each unit's durable trail.
5. Missing gh or unreadable Herdr state degrades to unavailable/unknown without
   crashing.
6. `GET /api/snapshot` returns fresh JSON; the CLI prints the same snapshot.
7. No mutation endpoints exist; the M0 API is read-only.
8. `npm run check` passes with the new workspace wired.

## Technical Notes

- **Location:** `factory-control/server/` — Node ≥22 + TypeScript, minimal deps
  (hono or `node:http`). Add workspace `factory-control/server` to root
  `package.json` `workspaces` and to `tsconfig.tests.json`.
- **Schema:** `FactorySnapshot` = `{ generatedAt, repo, units[], agents[], prs[], errors[] }`.
  `Unit` = `{ id, specPath?, title?, goal?, stage, flags, branch?, worktree?,
  agents[], handoffs[], pr?, attention[] }`.
- **Inference (pure, no tags):** decision order = merged&no worktree → done;
  PR+green → integrate(readyToMerge); PR → integrate; impl+review+qa →
  integrate; impl+review → qa; impl → review; live agent → execute; worktree →
  dispatch; spec only → spec; else unknown. Flags: reviewPending, qaPending,
  ciRed, readyToMerge, readyForCleanup, needsDispatch, blockedAgent.
- **Identity:** `canonicalId` lowercases and collapses non-alphanumerics; join
  SPEC/branch/worktree/PR/handoff by best overlap; unmatched → `orphaned`.
- **Sources:** `SPEC/*.md`; `git worktree list --porcelain`, `git branch
  --list 'factory/*'`, diff numstat vs `main`, dirty status; Herdr
  `~/.pi/agent/pi-herdsman/{results,runtime/mailboxes-v5,result-ref-reservations}`
  (defensive, fail → unknown); `gh pr list --state all` + `gh pr checks` (gh
  absent → unavailable).
- **API:** `GET /api/snapshot` (≤5 s cached), `GET /api/healthz`,
  `POST /api/refresh`; CLI `npm run factory:control -- snapshot [--json]`.

## Testing

- Unit: `canonicalId`, matching, decision table fixtures, malformed
  result/mailbox parsing.
- Integration: fixture temp repo → assert stages, flags, orphan bucket; no crash
  on missing dirs.
- Live smoke: `npm run factory:control -- snapshot --json` exits 0, valid JSON,
  ≥1 unit per existing SPEC file.
- Commands: `npm ci && npm run check` in the worktree.

## Item Links

None — foundation.
