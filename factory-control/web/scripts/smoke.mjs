import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "../../server/src/http.ts";
import { fixtureSnapshot } from "./smoke-fixture.mjs";

/**
 * End-to-end smoke for the M1 mirror (run after `npm run build`):
 *  1. builds the web app if dist is missing;
 *  2. starts the factory-control server against a fixture snapshot with the
 *     built app as its static root;
 *  3. asserts the shell, the snapshot API, the SPA fallback, and that every
 *     mutating method on the web surface returns 404/405.
 * Rendered DOM assertions (board/detail/agents) live in the integration test
 * (`src/integration.render.test.ts`); this smoke proves the shipped build and
 * the wired server.
 */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..", "dist");

if (!existsSync(join(webRoot, "index.html"))) {
  execSync("npm run build", { cwd: join(here, ".."), stdio: "inherit" });
}

const fixture = fixtureSnapshot();
const service = {
  get: async () => fixture,
  lastGeneratedAt: () => fixture.generatedAt,
};
const server = createApiServer(service, { webRoot });

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;

try {
  // Shell asset.
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes('<div id="root"></div>'), "shell root missing");

  // Snapshot API (read-only).
  const snapRes = await fetch(`${base}/api/snapshot`);
  assert.equal(snapRes.status, 200);
  const snap = await snapRes.json();
  assert.equal(snap.units.length, 2);
  assert.equal(snap.repo.branch, "main");

  // SPA fallback for a route.
  const spa = await fetch(`${base}/unit/T9-smoke`);
  assert.equal(spa.status, 200);
  assert.ok((await spa.text()).includes('<div id="root"></div>'), "SPA fallback missing");

  // Read-only enforcement: every mutating method on the web surface → 404/405.
  for (const path of ["/", "/unit/T9-smoke", "/agents", "/api/snapshot"]) {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      const res = await fetch(`${base}${path}`, { method });
      assert.ok([404, 405].includes(res.status), `${method} ${path} -> ${res.status}`);
    }
  }
  const unknownApi = await fetch(`${base}/api/nope`, { method: "GET" });
  assert.equal(unknownApi.status, 404);

  console.log(`SMOKE PASS (${base}): shell, snapshot API, SPA fallback, read-only methods`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
