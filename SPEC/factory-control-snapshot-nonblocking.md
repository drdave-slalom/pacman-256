# Factory spec: make the factory-control snapshot build non-blocking

**Status:** Draft — for builder execution. · **Symptom:** `/factory` (TUI) shows
"server unavailable" because the control server's HTTP event loop is frozen while
a snapshot is built. The snapshot build is fully synchronous: `readGitHub()`
loops over every PR (from `gh pr list --state all`) and for each runs a
synchronous `execFileSync("gh", ["pr","checks",…])` (`github.ts` → `git.ts`
`run()`). With ~30 PRs this blocks the server for ~30–40s (and a wedged `gh`
child can extend it), so all HTTP requests time out, the cache TTL (5s) never
helps, and the TUI's poll reports the server as unavailable.

## Goal

Keep the factory-control server responsive during snapshot builds: HTTP
requests (healthz, snapshot, actions, dispatch) must be served promptly even
while a snapshot is being (re)built. No blocking synchronous child spawns in
request-serving paths.

## Scope (in)

- Replace synchronous `execFileSync` gh/git reads with **async** spawns
  (`execFile`/`spawn` promisified) in `factory-control/server/src/github.ts`,
  `git.ts`, and any snapshot reader that runs in the request path.
- Ensure snapshot rebuilds run **off the event loop** and are **non-blocking**:
  a build in progress must not prevent other requests from being handled; a
  stale cached snapshot may be served while a refresh is in flight, or requests
  await a single shared in-flight build (one build at a time) rather than each
  forcing or blocking.
- Keep the snapshot API shape and semantics identical (5s TTL cache,
  `POST /api/refresh` forces a rebuild; `GET /api/snapshot` serves cached).
- Add a **timeout per gh/git child** (e.g. 10–15s) so a wedged `gh`/`git`
  child can never freeze the server indefinitely; on timeout, degrade that PR
  to `checks: "unknown"` (or `unavailable`) and record an `errors` entry.
- Add tests: concurrent requests during a slow (fake) build are served promptly;
  a hanging gh child times out and degrades rather than blocking; refresh-in-
  flight coalesces; snapshot shape unchanged.

## Out of scope

- Changing the snapshot schema or API.
- Changing the TUI/extension (it already polls; it should just get responses).
- Authentication/security changes.
- Any other feature work.

## Acceptance criteria

1. `GET /api/healthz` responds quickly (<1s) even while a snapshot is being
   built/rebuilt.
2. `GET /api/snapshot` serves the cached snapshot immediately when fresh; when
   stale or forced, the build runs without blocking other requests, and the
   request completes once the (shared, coalesced) build finishes.
3. A gh/git child that hangs past its timeout degrades that PR/read to
   `unknown`/`unavailable` (with an `errors` entry) and never freezes the
   server.
4. Repeated concurrent snapshot requests during a build share one build (no
   duplicate thundering herd).
5. `npm run check` passes (all existing tests + new ones green).
6. Live check: with the server running, `/factory` in the pi TUI shows the
   board within a few seconds (no "server unavailable") on a real repo.

## Validation

Inside the worktree: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run check`; plus a live probe — start the server, hit healthz/snapshot
during a build (observe responsiveness), and note snapshot build time with many
PRs. Report actual outputs.

## Handoff

Builder reports: files changed, sync→async call sites, timeout/degradation
behavior, tests added, before/after latency observations, risks, remaining work,
three-way reconciliation.
