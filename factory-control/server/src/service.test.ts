import assert from "node:assert/strict";
import { test } from "node:test";
import { SnapshotService } from "./service.ts";
import type { SnapshotOptions } from "./snapshot.ts";
import type { FactorySnapshot } from "./types.ts";

let seq = 0;
function makeSnapshot(): FactorySnapshot {
  seq += 1;
  return {
    generatedAt: `g${seq}`,
    repo: { root: "/repo", branch: "main", dirty: false },
    units: [],
    agents: [],
    prs: [],
    orphaned: { branches: [], worktrees: [], handoffs: [], prs: [] },
    errors: [],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const opts: SnapshotOptions = { root: "/repo", noGh: true };

test("service: fresh cached snapshot is served without rebuilding", async () => {
  let builds = 0;
  const service = new SnapshotService(opts, 60_000, async () => {
    builds += 1;
    return makeSnapshot();
  });

  const first = await service.get();
  const second = await service.get();
  assert.equal(first.generatedAt, second.generatedAt);
  assert.equal(builds, 1);
});

test("service: stale cache is served immediately while a refresh is in flight", async () => {
  let builds = 0;
  const gate = deferred<FactorySnapshot>();
  const service = new SnapshotService(opts, 0, async () => {
    builds += 1;
    if (builds === 1) return makeSnapshot(); // prime
    return gate.promise; // slow refresh
  });

  const stale = await service.get(); // prime (builds = 1)
  const refreshing = service.get(true); // starts slow refresh (builds = 2)

  const t0 = Date.now();
  const results = await Promise.all([service.get(), service.get(), service.get()]);
  const elapsed = Date.now() - t0;

  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.generatedAt, stale.generatedAt);
  assert.ok(elapsed < 500, `stale reads were prompt (${elapsed}ms)`);
  assert.equal(builds, 2); // the concurrent reads did not spawn extra builds

  gate.resolve(makeSnapshot());
  const fresh = await refreshing;
  assert.notEqual(fresh.generatedAt, stale.generatedAt);
});

test("service: concurrent forced refreshes coalesce into one build", async () => {
  let builds = 0;
  const gate = deferred<FactorySnapshot>();
  const service = new SnapshotService(opts, 0, async () => {
    builds += 1;
    if (builds === 1) return makeSnapshot();
    return gate.promise;
  });

  await service.get(); // prime (builds = 1)
  const r1 = service.get(true);
  const r2 = service.get(true);
  assert.equal(builds, 2); // exactly one refresh build for two forced reads

  gate.resolve(makeSnapshot());
  const [a, b] = [await r1, await r2];
  assert.equal(a.generatedAt, b.generatedAt);
  assert.equal(builds, 2);
});

test("service: cold-start concurrent reads share a single build", async () => {
  let builds = 0;
  const gate = deferred<FactorySnapshot>();
  const service = new SnapshotService(opts, 60_000, async () => {
    builds += 1;
    return gate.promise;
  });

  const p1 = service.get();
  const p2 = service.get();
  assert.equal(builds, 1);

  gate.resolve(makeSnapshot());
  const [a, b] = [await p1, await p2];
  assert.equal(a.generatedAt, b.generatedAt);
  assert.equal(builds, 1);
});

test("service: a failed build does not wedge later reads", async () => {
  let builds = 0;
  const service = new SnapshotService(opts, 0, async () => {
    builds += 1;
    if (builds === 1) throw new Error("boom");
    return makeSnapshot();
  });

  await assert.rejects(() => service.get(), /boom/);
  const snap = await service.get();
  assert.ok(snap.generatedAt);
});

test("service: returned snapshot keeps the canonical shape", async () => {
  const service = new SnapshotService(opts, 60_000, async () => makeSnapshot());
  const snap = await service.get();
  assert.equal(typeof snap.generatedAt, "string");
  assert.equal(typeof snap.repo.root, "string");
  assert.ok(Array.isArray(snap.units));
  assert.ok(Array.isArray(snap.agents));
  assert.ok(Array.isArray(snap.prs));
  assert.deepEqual(Object.keys(snap.orphaned).sort(), ["branches", "handoffs", "prs", "worktrees"]);
  assert.ok(Array.isArray(snap.errors));
});
