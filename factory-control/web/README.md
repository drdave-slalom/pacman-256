# factory-control web mirror (M1)

Read-only web mirror of the factory snapshot: kanban board, unit detail, and
herd/agent panel. Served as a static build by the factory-control server.

## Quick start

```sh
npm ci
# 1. Start the control server (snapshot API + web static):
npm run factory:control:serve
# 2. Open http://127.0.0.1:4780/  (default bind; see trust note below)
```

`npm run build` compiles this workspace into `factory-control/web/dist` (wired
into the root `npm run check` pipeline). The control server serves that dist
with an SPA fallback, so `/unit/:id` and `/agents` resolve to the app shell.

## LAN access (trust decision)

The control server binds `HOST`/`PORT` (default `127.0.0.1:4780`). To open the
mirror from another machine on your network:

```sh
HOST=0.0.0.0 npm run factory:control:serve
# browse to http://<your-lan-ip>:4780/
```

Binding `0.0.0.0` exposes the snapshot API and the mirror to the whole network.
M1 has **no authentication** — only bind `0.0.0.0` on a trusted LAN.

## Development

```sh
npm run dev        # Vite dev server on 127.0.0.1:4173 (HOST/PORT env)
# proxies /api → http://127.0.0.1:4780 (FACTORY_API_TARGET to override)
npm test           # pure selector unit tests + SSR rendering integration test
npm run smoke      # build + live end-to-end smoke against a fixture snapshot
```

## Read-only contract

- The app performs exactly one network call: `GET /api/snapshot` (polled every
  ~5 s). No UI element writes anything.
- The server rejects mutating methods on the web surface with 405 (`Allow:
  GET, HEAD`) and mutations on the snapshot API with 404 (verified by
  `factory-control/server/src/http.static.test.ts`).
- Exception: the pre-existing M0 endpoint `POST /api/refresh` (server-side
  snapshot cache re-read) still returns 200. It mutates no state and the web
  UI never calls it — the M1 surface itself remains strictly read-only.

## Snapshot types

Types are shared verbatim with the server via the
`@maze/factory-control-shared` workspace (`factory-control/shared/src/index.ts`);
the server re-exports them from `factory-control/server/src/types.ts`.
