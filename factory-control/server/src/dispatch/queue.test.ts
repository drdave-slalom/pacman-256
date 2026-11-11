import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DispatchQueue } from "./queue.ts";
import type { DispatchEntry } from "./types.ts";

function tempDir(prefix = "factory-dispatch-queue-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function baseEntry(id = "req-abc123"): DispatchEntry {
  return {
    id,
    at: "2026-01-01T00:00:00.000Z",
    unit: "t1fx",
    specPath: "SPEC/T1-fx.md",
    worktree: "factory/t1fx",
    role: "builder",
    acceptance: "Implement t1fx per SPEC/T1-fx.md.",
    status: "queued",
  };
}

test("append persists a JSONL line and an event; list replays queued", () => {
  const dir = tempDir();
  const queue = new DispatchQueue({ dir });
  const entry = queue.append(baseEntry());

  assert.equal(entry.status, "queued");
  assert.equal(queue.list().length, 1);

  const queueText = readFileSync(join(dir, "queue.jsonl"), "utf8");
  const lines = queueText.trim().split("\n");
  assert.equal(lines.length, 1, "append-only: exactly one creation line");
  const parsed = JSON.parse(lines[0] ?? "") as DispatchEntry;
  assert.equal(parsed.id, entry.id);
  assert.equal(parsed.status, "queued");

  const eventsText = readFileSync(join(dir, "events.jsonl"), "utf8");
  const event = JSON.parse(eventsText.trim().split("\n")[0] ?? "") as { id: string; status: string };
  assert.equal(event.id, entry.id);
  assert.equal(event.status, "queued");
});

test("allowed explicit transitions are queued → dispatched → done/cancelled", () => {
  const queue = new DispatchQueue({ dir: tempDir() });
  const entry = queue.append(baseEntry());

  // queued → dispatched
  let r = queue.transition(entry.id, "dispatched");
  assert.equal(r.ok, true);
  assert.equal(r.entry.status, "dispatched");

  // dispatched → done
  r = queue.transition(entry.id, "done");
  assert.equal(r.ok, true);
  assert.equal(r.entry.status, "done");

  // Done is terminal: no reverse/resurrect.
  r = queue.transition(entry.id, "dispatched");
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /invalid transition/);

  // queued → cancelled is allowed; a cancelled entry is terminal.
  const q = new DispatchQueue({ dir: tempDir() });
  const e2 = q.append(baseEntry("req-xyz"));
  assert.equal(q.transition(e2.id, "cancelled").ok, true);
  assert.equal(q.transition(e2.id, "dispatched").ok, false);
  assert.equal(q.transition(e2.id, "done").ok, false);
});

test("same-status transition is idempotent", () => {
  const queue = new DispatchQueue({ dir: tempDir() });
  const entry = queue.append(baseEntry());
  assert.equal(queue.transition(entry.id, "queued").ok, true);
});

test("unknown entry transition fails", () => {
  const queue = new DispatchQueue({ dir: tempDir() });
  const r = queue.transition("nope", "dispatched");
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /no such queue entry/);
});

test("evidence moves forward only: queued→dispatched, queued→done, dispatched→done", () => {
  const queue = new DispatchQueue({ dir: tempDir() });

  const a = queue.append(baseEntry("req-a"));
  const b = queue.append(baseEntry("req-b"));
  const c = queue.append(baseEntry("req-c"));
  const d = queue.append(baseEntry("req-d"));

  // queued → dispatched
  assert.equal(queue.evidence(a.id, "dispatched").changed, true);
  assert.equal(queue.find(a.id)?.status, "dispatched");
  assert.equal(queue.evidence(a.id, "dispatched").changed, false, "idempotent");

  // dispatched → done
  assert.equal(queue.evidence(a.id, "done").changed, true);
  assert.equal(queue.find(a.id)?.status, "done");

  // queued → done directly (handoff arrived before dispatch mark)
  assert.equal(queue.evidence(b.id, "done").changed, true);
  assert.equal(queue.find(b.id)?.status, "done");

  // reversed evidence is rejected
  assert.equal(queue.evidence(a.id, "dispatched").changed, false);
  assert.equal(queue.evidence(b.id, "queued").changed, false);

  // evidence must never cancel
  assert.equal(queue.evidence(c.id, "cancelled").changed, false);
  assert.equal(queue.find(c.id)?.status, "queued");
  const cancelled = queue.transition(c.id, "cancelled");
  assert.equal(cancelled.ok, true);
  assert.equal(queue.evidence(c.id, "done").changed, false, "cancelled stays terminal");

  // d stays queued
  assert.equal(queue.find(d.id)?.status, "queued");
});

test("queue survives re-instantiation (replay from append-only logs)", () => {
  const dir = tempDir();
  const queue = new DispatchQueue({ dir });
  const entry = queue.append(baseEntry());
  queue.transition(entry.id, "dispatched");
  queue.transition(entry.id, "done");

  const reloaded = new DispatchQueue({ dir });
  const entries = reloaded.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.status, "done");
  assert.equal(entries[0]?.unit, "t1fx");

  // Append-only: creation + 3 events (enqueued, dispatched, done).
  const events = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n");
  assert.equal(events.length, 3);
});

test("malformed lines are skipped without breaking the queue", () => {
  const dir = tempDir();
  const queue = new DispatchQueue({ dir });
  queue.append(baseEntry("req-good"));
  appendFileSync(join(dir, "queue.jsonl"), "{not-json}\n");
  appendFileSync(join(dir, "events.jsonl"), "{\"id\":\"req-good\",\"at\":\"x\",\"status\":\"dispatched\"}\n");
  const entries = queue.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.status, "dispatched");
});
