import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApiServer } from "./http.ts";
import { SnapshotService } from "./service.ts";

function fixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "factory-http-repo-"));
  mkdirSync(join(repo, "SPEC"));
  writeFileSync(join(repo, "SPEC", "T9-http.md"), "# T9 spec: http\n\n## Goal\n\nHTTP fixture.\n");
  return repo;
}

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const root = fixtureRepo();
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = join(tmpdir(), "factory-http-herdr-nope-" + Date.now());
  const service = new SnapshotService({ root, noGh: true }, 60_000);
  const server = createApiServer(service);
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

test("healthz reports ok and snapshotAt", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; snapshotAt: string | null };
    assert.equal(body.ok, true);
  });
});

test("snapshot endpoint returns fresh JSON (read-only)", async () => {
  await withServer(async (base) => {
    const snapshotRes = await fetch(`${base}/api/snapshot`);
    assert.equal(snapshotRes.status, 200);
    assert.equal(snapshotRes.headers.get("cache-control"), "no-store");
    const snapshot = (await snapshotRes.json()) as { units: unknown[]; repo: { branch: string } };
    assert.equal(snapshot.units.length, 1);
    assert.equal(snapshot.repo.branch, "unknown");

    const refreshRes = await fetch(`${base}/api/refresh`, { method: "POST" });
    assert.equal(refreshRes.status, 200);
    const refreshed = (await refreshRes.json()) as { units: unknown[] };
    assert.equal(refreshed.units.length, 1);
  });
});

test("non-snapshot methods and paths are 404 (read-only API)", async () => {
  await withServer(async (base) => {
    for (const [method, path] of [
      ["DELETE", "/api/snapshot"],
      ["PUT", "/api/snapshot"],
      ["GET", "/api/nope"],
      ["GET", "/api/snapshot/extra"],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method });
      assert.equal(res.status, 404, `${method} ${path}`);
    }
  });
});
