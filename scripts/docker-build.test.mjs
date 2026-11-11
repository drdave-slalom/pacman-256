import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Docker uses explicit game build order independently of repository build", () => {
  const { scripts } = JSON.parse(read("package.json"));
  assert.equal(scripts["build:game"], "npm --workspace @maze/shared run build && npm --workspace @maze/server run build && npm --workspace @maze/client run build");
  for (const workspace of ["shared", "server", "web", "tui"]) {
    assert.ok(scripts.build.includes(`factory-control/${workspace}`), "full build retains factory tooling");
  }
  assert.equal(scripts.check, "npm run typecheck && npm test && npm run build");
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /RUN npm run build:game\n/);
  assert.doesNotMatch(dockerfile, /RUN npm run build\n|COPY \.|COPY factory-control/);
  const runtime = dockerfile.split("AS runtime")[1];
  assert.match(runtime, /npm ci --omit=dev --workspace @maze\/shared --workspace @maze\/server --include-workspace-root=false/);
  assert.doesNotMatch(runtime, /COPY apps\/client\/package.json/);
  assert.match(runtime, /USER node/);
});

test("CI retains Validate jobs and adds a read-only non-publishing image smoke gate", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /pull_request:/);
  assert.match(ci, /contents: read/);
  assert.match(ci, /name: Validate \(Node \$\{\{ matrix.node \}\}\)/);
  const dockerJob = ci.split("  docker:\n")[1].split("  validate:\n")[0];
  assert.match(dockerJob, /persist-credentials: false/);
  assert.match(dockerJob, /docker build --tag maze-workshop:ci \./);
  assert.match(dockerJob, /npm run smoke:docker/);
  assert.doesNotMatch(dockerJob, /secrets\.|login-action|docker push|push: true|packages: write|pull_request_target/);
});
