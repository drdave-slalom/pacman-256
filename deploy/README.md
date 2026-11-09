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

- The client connects to `ws(s)://<host>/multiplayer` on the same origin, so
  a single HTTP/WebSocket endpoint is enough. The server binds `0.0.0.0`
  (env `HOST`, default) and serves both the static client
  (`CLIENT_DIST`, default `<cwd>/client-dist`) and the Colyseus rooms.
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
