import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AuditLog } from "./audit.ts";

function auditFile(): string {
  return join(mkdtempSync(join(tmpdir(), "factory-audit-")), "audit.log.jsonl");
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    action: "pr/merge",
    requestId: "req-1",
    operator: "lead",
    preconditions: [{ name: "unit-found", ok: true, detail: "ok" }],
    outcome: "prepared" as const,
    ...overrides,
  };
}

test("append writes JSONL and recent() returns newest last", () => {
  const file = auditFile();
  const log = new AuditLog({ file });
  log.append(line());
  log.append(line({ requestId: "req-2" }));
  log.append(line({ requestId: "req-3", outcome: "success", exit: 0 }));

  const recent = log.recent(10);
  assert.equal(recent.length, 3);
  assert.equal(recent[2]?.requestId, "req-3");
  assert.equal(recent[2]?.exit, 0);
  const raw = readFileSync(file, "utf8");
  assert.equal(raw.trim().split("\n").length, 3);
});

test("recent(limit) caps the number of lines", () => {
  const log = new AuditLog({ file: auditFile() });
  for (let i = 0; i < 10; i++) log.append(line({ requestId: `req-${i}` }));
  const recent = log.recent(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0]?.requestId, "req-7");
});

test("append is append-only and survives malformed trailing lines", () => {
  const file = auditFile();
  const log = new AuditLog({ file });
  log.append(line());
  log.append(line({ requestId: "req-2" }));
  // A foreign writer appends garbage; the log is never truncated.
  appendFileSync(file, "{not json}\n");
  const recent = log.recent(10);
  assert.equal(recent.length, 2);
  assert.equal(recent[1]?.requestId, "req-2");
});

test("missing audit file reads as empty", () => {
  const log = new AuditLog({ file: join(mkdtempSync(join(tmpdir(), "factory-audit-")), "nope.jsonl") });
  assert.deepEqual(log.recent(5), []);
});
