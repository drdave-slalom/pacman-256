import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./git.ts";

test("run: success captures stdout asynchronously", async () => {
  const result = await run("node", ["-e", "process.stdout.write('hello')"]);
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "hello");
  assert.equal(result.status, 0);
  assert.equal(result.timedOut, undefined);
});

test("run: non-zero exit reports failure with stderr", async () => {
  const result = await run("node", ["-e", "process.stderr.write('boom'); process.exit(3)"]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /boom/);
});

test("run: missing command reports spawn failure (does not throw)", async () => {
  const result = await run("definitely-not-a-real-command-xyz", []);
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
});

test("run: a hanging child times out and degrades (never freezes)", async () => {
  const t0 = Date.now();
  const result = await run("node", ["-e", "setTimeout(() => {}, 60_000)"], { timeoutMs: 150 });
  const elapsed = Date.now() - t0;
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.status, null);
  assert.ok(elapsed < 3_000, `timeout resolved promptly (${elapsed}ms)`);
});

test("run: respects FACTORY_GH_TIMEOUT_MS env override (default 15s)", async () => {
  const previous = process.env.FACTORY_GH_TIMEOUT_MS;
  process.env.FACTORY_GH_TIMEOUT_MS = "100";
  try {
    const t0 = Date.now();
    const result = await run("node", ["-e", "setTimeout(() => {}, 60_000)"]);
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.ok(elapsed < 3_000, `env timeout applied (${elapsed}ms)`);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_GH_TIMEOUT_MS;
    else process.env.FACTORY_GH_TIMEOUT_MS = previous;
  }
});
