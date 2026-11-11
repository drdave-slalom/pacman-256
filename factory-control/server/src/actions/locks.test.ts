import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LockManager, type LockInfo } from "./locks.ts";

function lockDir(): string {
  return mkdtempSync(join(tmpdir(), "factory-locks-"));
}

function info(unit: string, overrides: Partial<LockInfo> = {}): LockInfo {
  return { unit, requestId: "req-1", operator: "op", acquiredAt: Date.now(), pid: process.pid, ...overrides };
}

test("acquire/release round-trips; different units do not conflict", () => {
  const mgr = new LockManager({ dir: lockDir() });
  assert.ok(mgr.tryAcquire("t1", info("t1")).ok);
  assert.equal(mgr.tryAcquire("t1", info("t1")).ok, false, "same unit blocked");
  assert.ok(mgr.tryAcquire("t2", info("t2")).ok, "different unit allowed");
  assert.equal(mgr.list().length, 2);
  mgr.release("t1");
  assert.ok(mgr.tryAcquire("t1", info("t1")).ok, "released lock is acquirable");
});

test("fresh lock is not releasable with override", () => {
  const mgr = new LockManager({ dir: lockDir() });
  assert.ok(mgr.tryAcquire("t1", info("t1")).ok);
  const second = mgr.tryAcquire("t1", info("t1"), { override: true });
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.reason, /in progress|lock held/);
});

test("stale lock (old acquiredAt) requires override", () => {
  const dir = lockDir();
  const staleInfo = info("t1", { acquiredAt: Date.now() - 2 * 60 * 60 * 1000 });
  writeFileSync(join(dir, "t1.lock"), JSON.stringify(staleInfo));
  const mgr = new LockManager({ dir, staleMs: 60 * 60 * 1000 });

  const denied = mgr.tryAcquire("t1", info("t1"));
  assert.equal(denied.ok, false);
  assert.match(denied.ok ? "" : denied.reason, /stale/);

  const overridden = mgr.tryAcquire("t1", info("t1"), { override: true });
  assert.ok(overridden.ok, "override releases stale lock");
});

test("lock held by a dead pid is stale", () => {
  const dir = lockDir();
  writeFileSync(join(dir, "t1.lock"), JSON.stringify(info("t1", { pid: 999_999_999 })));
  const mgr = new LockManager({ dir });
  const existing = mgr.list()[0];
  assert.ok(existing);
  assert.equal(mgr.isStale(existing), true);
  assert.ok(mgr.tryAcquire("t1", info("t1"), { override: true }).ok);
});

test("clock injection drives staleness", () => {
  let now = 1_000_000;
  const mgr = new LockManager({ dir: lockDir(), staleMs: 60_000, clock: () => now });
  assert.ok(mgr.tryAcquire("t1", info("t1", { acquiredAt: now })).ok);
  now += 120_000;
  const existing = mgr.list()[0];
  assert.ok(existing);
  assert.equal(mgr.isStale(existing), true);
});
