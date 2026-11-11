# Deployment

This directory holds everything needed to ship the game to a Kubernetes cluster
(verified against a DigitalOcean Kubernetes — DOKS — cluster).

- `Dockerfile` — multi-stage image that builds the shared/server/client
  workspaces and runs the Colyseus server, which also serves the built client
  as static files (one container = the whole game).
- `k8s/` — namespace, Deployment, and LoadBalancer Service manifests.
- `.github/workflows/deploy.yml` — CI pipeline: verify → build → push to GHCR
  → apply manifests → roll out the new image.

## How it works

- The production client connects to the same-origin root (`ws(s)://<host>/`)
  because this server exposes Colyseus's matchmaking and room routes at the
  root, so a single HTTP/WebSocket endpoint is enough. (The `/multiplayer`
  prefix is only used in local dev, where the Vite dev server proxies and
  strips it.) The server binds `0.0.0.0` (env `HOST`, default) and serves
  both the static client (`CLIENT_DIST`, default `<cwd>/client-dist`) and
  the Colyseus rooms.
- The Service is `LoadBalancer`; DigitalOcean provisions a public IP
  automatically. No ingress controller is required for the MVP.

## GitHub secrets / variables required by the workflow

| Setting | Required | Notes |
|---|---|---|
| `DO_API_TOKEN` (secret) | yes | DigitalOcean personal access token with read access to the cluster's kubeconfig. |
| `DO_CLUSTER_NAME` (variable) | no | Cluster name for `doctl kubernetes cluster kubeconfig save`. Defaults to `waka-waka`. |
| `GITHUB_TOKEN` | automatic | Provided by GitHub Actions; the workflow requests `packages: write` to push to GHCR. |

Triggers: push to `main` (and `workflow_dispatch`). The rollback path is the
previous image tag: `kubectl -n maze-workshop set image deployment/maze-game
maze-game=ghcr.io/<owner>/<repo>:sha-<prev-sha>`.

## Local image validation (no publication)

The Dockerfile calls `npm run build:game` (shared → server → client), not the
full-repository `npm run build`, which also compiles factory-control tooling.
Build dependencies are selected from the root lockfile by explicit game
workspaces; runtime installs only server/shared production dependencies and
copies the built client as static files. No factory-control sources or outputs
are copied. The image retains the nonroot `node` user and `CLIENT_DIST`.

```sh
npm ci
npm run check
npm run test:docker
docker build --tag maze-workshop:ci .
DOCKER_IMAGE=maze-workshop:ci npm run smoke:docker
```

The smoke script starts one container on a random loopback-only host port,
overrides `PORT`, checks protocol-v1 health and referenced HTML/assets, and
creates/joins a two-player game through the deployed root Colyseus HTTP/WebSocket
route. It removes its exact container on completion, including assertion failure.
The CI **Game image build and smoke** job runs these image checks on PRs without
secrets, registry login/push, or deployment. Existing Validate jobs still check
the full repository. Local success does not verify production rollout, TLS,
load balancing, or physical-phone gameplay.

## Local (manual) equivalents

```sh
# Build and (optionally) push the image
docker build -t ghcr.io/<owner>/<repo>:local .
# docker push ghcr.io/<owner>/<repo>:local

# Apply manifests
kubectl apply -f deploy/k8s/00-namespace.yaml
kubectl apply --recursive -f deploy/k8s
kubectl -n maze-workshop set image deployment/maze-game \
  maze-game=ghcr.io/<owner>/<repo>:local
kubectl -n maze-workshop rollout status deployment/maze-game

# The game is served at the Service's EXTERNAL-IP:
kubectl -n maze-workshop get svc maze-game
```
