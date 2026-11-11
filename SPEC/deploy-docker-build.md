# Deploy — restore game-only image build

Issue: https://github.com/drdave-slalom/pacman-256/issues/46
Owner: @clee231. Base: origin/main at 3b48b48. Existing primary checkout has unrelated local documentation commit; never change it.

## Problem / evidence
Standard CI passes but main Deploy run 43021548482 fails in Dockerfile RUN npm run build: factory-control/shared absent. Dockerfile copies only game source/manifests, while root build expanded to operator-tool packages. First failing Deploy after M0 PR #38 was missing factory-control/server (42929170854); earlier Deploy 42926030548 succeeded.

## Goal and scope
Restore reproducible game-only production image building from clean context; add regression protection before PR merge. Keep repository-wide build/typecheck/tests intact. Allowed surfaces: Dockerfile, .dockerignore if needed, root package scripts if a clear scoped game-build script helps, focused regression tests/scripts, CI workflow for a non-publishing image-build/smoke gate, and narrowly relevant deployment documentation. No gameplay changes, dependency upgrades, credentials, cloud/Kubernetes changes, operator tool exposure, or refactoring unrelated factory tooling.

## Acceptance criteria
1. Docker build compiles shared game package → server → client only (not factory control), with explicit stable script/workspace targets; root npm run build/check must still cover all existing workspaces.
2. Production image installs reproducible needed game dependencies and built outputs, contains no operational factory-control server/web/TUI, runs existing nonroot node user, and retains configured PORT/CLIENT_DIST/static/client and WebSocket behavior. Validate npm workspace manifests/lockfile handling; avoid broad copy of full repo just to mask the missing package problem.
3. Real `docker build` succeeds from clean tracked context. Local container starts, /health responds correct protocol, client HTML/assets serve, and a real Colyseus create/join probe succeeds via deployed HTTP/WebSocket route. Stop exact test containers/processes. Never push test images or touch production for local tests.
4. Add focused regression coverage plus a PR CI non-publishing Docker build/smoke check so future changes to root tooling cannot silently break Deploy while ordinary CI stays green. Preserve existing required Validate job names. Avoid privileged/untrusted credential access; PR build must not deploy or log in/push registries.
5. Run npm run check, focused tests, image build and smoke; independent reviewer and QA pass. Existing nonfatal bundle warnings may remain; do not claim production success from local success.
6. Update only necessary docs to explain game vs full-repository builds and actual validation. Do not change approved product decisions. One small implementation-context note is acceptable; no broad generated status rewrites.

## Plan / handoff
Builder owns resolved fix and focused tests; independent pr-reviewer and qa-tester follow, at most two review/fix cycles per D050. Commit respecting hooks, return changed paths, precise root cause, commands/results/log paths, image/runtime observations and limitations. Escalate material scope/security conflicts or unavailable Docker. Docker is available locally (daemon reported 29.9.3). Do not push branch/image, open/merge PR or modify issues: Lead owns publication and CI watch.
