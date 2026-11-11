import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "./http.ts";
import { SnapshotService } from "./service.ts";
import { webFilePath } from "./static.ts";

/**
 * M1 integration coverage for the web mirror surface:
 * - the control server serves the built static app (shell + assets) and
 *   falls back to the SPA shell for extension-less routes;
 * - every mutating method on the web surface (and on snapshot API paths)
 *   returns 404/405 — read-only is enforced at the HTTP edge;
 * - path traversal is rejected at the resolver level (`webFilePath`), and
 *   asset-like paths that resolve outside the web root are never served.
 */

function writeDist(): string {
  const dist = join(mkdtempSync(join(tmpdir(), "factory-web-dist-")), "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><html><head><title>mirror</title></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>',
  );
  writeFileSync(join(dist, "assets", "app.js"), "console.log('mirror');");
  return dist;
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "factory-static-repo-"));
  mkdirSync(join(root, "SPEC"));
  writeFileSync(join(root, "SPEC", "T9-static.md"), "# T9 spec: static\n\n## Goal\n\nStatic fixture.\n");
  const webRoot = writeDist();
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(tmpdir(), "factory-static-herdr-nope-" + Date.now());
  const service = new SnapshotService({ root, noGh: true }, 60_000);
  const server = createApiServer(service, { webRoot });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
}

test("serves the built web app at / and falls back to index.html for SPA routes", async () => {
  await withServer(async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.ok((await home.text()).includes('<div id="root"></div>'));

    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/);

    const spa = await fetch(`${base}/unit/T9-static`);
    assert.equal(spa.status, 200);
    assert.ok((await spa.text()).includes('<div id="root"></div>'));
  });
});

test("HEAD responses carry headers but no body", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/assets/app.js`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "", "HEAD must not body a body");
    assert.ok(Number(res.headers.get("content-length")) > 0, "content-length kept");
  });
});

test("asset-like paths that do not exist are 404 (no SPA fallback)", async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/assets/nope.js`);
    assert.equal(missing.status, 404);
    const missingTxt = await fetch(`${base}/secret.txt`);
    assert.equal(missingTxt.status, 404);
  });
});

test("web-surface mutations (POST/DELETE/PUT) are 405", async () => {
  await withServer(async (base) => {
    for (const path of ["/", "/unit/T9-static", "/agents"]) {
      for (const method of ["POST", "DELETE", "PUT"] as const) {
        const res = await fetch(`${base}${path}`, { method });
        assert.equal(res.status, 405, `${method} ${path}`);
        assert.equal(res.headers.get("allow"), "GET, HEAD");
      }
    }
  });
});

test("API mutations (POST/DELETE/PUT/PATCH) are 404; unknown GET is 404", async () => {
  await withServer(async (base) => {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"] as const) {
      const res = await fetch(`${base}/api/snapshot`, { method });
      assert.equal(res.status, 404, `${method} /api/snapshot`);
    }
    const nope = await fetch(`${base}/api/nope`, { method: "GET" });
    assert.equal(nope.status, 404);
  });
});

test("webFilePath rejects traversal and keeps serves inside the web root", () => {
  const dist = writeDist();
  assert.equal(webFilePath(dist, "/../../etc/passwd"), null);
  assert.equal(webFilePath(dist, "/a/../../../b"), null);
  assert.equal(webFilePath(dist, "/%2e%2e/etc/passwd"), null);
  assert.ok(webFilePath(dist, "/assets/app.js")?.endsWith(join("assets", "app.js")));
  assert.ok(webFilePath(dist, "/")?.endsWith("index.html"));
});
