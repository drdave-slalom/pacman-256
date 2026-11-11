import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DispatchService } from "./service.ts";
import { createApiServer } from "../http.ts";
import { SnapshotService } from "../service.ts";
import type { DispatchEntry } from "./types.ts";

// ---- git fixture helpers -------------------------------------------------------

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo(): { repo: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "factory-dispatch-int-repo-"));
  const repo = join(parent, "repo");
  mkdirSync(join(repo, "SPEC"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Factory Test");
  writeFileSync(join(repo, "SPEC", "T9-dispatch.md"), "# T9 spec: dispatch\n\n## Goal\n\nDispatch fixture.\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  return { repo, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function writeHandoff(herdrRoot: string, label: string): string {
  const resultsDir = join(herdrRoot, "results");
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, label);
  writeFileSync(
    file,
    `Agent result source: ${JSON.stringify({ agent: label, definition: "builder" })}\nDone — handoff fixture.\n`,
    "utf8",
  );
  return file;
}

function writeLiveAgent(herdrRoot: string, label: string): string {
  const dir = join(herdrRoot, "runtime", "mailboxes-v5", label);
  mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({ agentLabel: label, status: "working", agentDefinition: "builder", availableTools: ["read"] }),
    "utf8",
  );
  return stateFile;
}

test("integration: enqueue → no agent spawned → dispatched → handoff closes to done", async () => {
  const { repo, cleanup } = makeRepo();
  const herdrRoot = tempDir("factory-dispatch-int-herdr-");
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = herdrRoot;
  const service = new SnapshotService({ root: repo, noGh: true }, 60_000);
  const dispatch = new DispatchService({ snapshot: () => service.get(), factoryRoot: repo });
  const server = createApiServer(service, {
    webRoot: tempDir("factory-dispatch-int-web-"),
    dispatch,
  });
  let base = "";
  try {
    base = await listen(server);

    // prepare → plan
    const prepRes = await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    });
    assert.equal(prepRes.status, 200);
    const prep = (await prepRes.json()) as {
      requestId: string;
      entryId: string;
      ok: boolean;
      plan: { kind: string; role: string; worktree: string; specPath: string; acceptance: string; delegationPrompt: string };
    };
    assert.equal(prep.ok, true, JSON.stringify(prep));
    assert.equal(prep.plan.kind, "dispatch");
    assert.equal(prep.plan.role, "builder");
    assert.equal(prep.plan.worktree, "factory/t9dispatch");
    assert.equal(prep.plan.specPath, "SPEC/T9-dispatch.md");
    assert.ok(prep.plan.acceptance.includes("npm run check"));
    assert.ok(prep.plan.delegationPrompt.includes("delegate_agent"));

    // enqueue → persisted
    const enqRes = await fetch(`${base}/api/dispatch/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prep.requestId }),
    });
    assert.equal(enqRes.status, 200);
    const enq = (await enqRes.json()) as { entry: DispatchEntry; prompt: string };
    assert.equal(enq.entry.id, prep.entryId);
    assert.equal(enq.entry.status, "queued");
    assert.ok(enq.prompt.includes("delegate_agent"));
    assert.ok(enq.prompt.includes("factory/t9dispatch"));

    // listable
    const listRes = await fetch(`${base}/api/dispatch/queue`);
    const list = (await listRes.json()) as { entries: DispatchEntry[] };
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0]?.status, "queued");

    // NO agents/processes spawned by the server: the herdr root has no
    // mailboxes, no results, and the snapshot reports no agents.
    assert.throws(() => readdirSync(join(herdrRoot, "runtime", "mailboxes-v5")));
    assert.throws(() => readdirSync(join(herdrRoot, "results")));
    const snapRes = await fetch(`${base}/api/snapshot`);
    const snap = (await snapRes.json()) as { units: { id: string; agents: unknown[] }[] };
    assert.equal(snap.units[0]?.agents.length, 0, "no agent appears in the snapshot after enqueue");

    // The queue file is append-only: one creation line, even after transitions.
    const queueFile = join(repo, "factory-control", "state", "dispatch-queue", "queue.jsonl");
    const creationLines = readFileSync(queueFile, "utf8").trim().split("\n");
    assert.equal(creationLines.length, 1);
    const eventsFile = join(repo, "factory-control", "state", "dispatch-queue", "events.jsonl");
    const eventLines = readFileSync(eventsFile, "utf8").trim().split("\n");
    assert.equal(eventLines.length, 1, "only the enqueued event so far");

    // Simulate the Lead marking dispatched.
    const statusRes = await fetch(`${base}/api/dispatch/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: enq.entry.id, status: "dispatched" }),
    });
    assert.equal(statusRes.status, 200);
    const dispatched = (await statusRes.json()) as { entry: DispatchEntry };
    assert.equal(dispatched.entry.status, "dispatched");

    // Reject a reversed transition (done is terminal).
    const bad = await fetch(`${base}/api/dispatch/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: enq.entry.id, status: "queued" }),
    });
    assert.equal(bad.status, 400);

    // Fixture handoff closes the entry to done via snapshot evidence.
    writeHandoff(herdrRoot, "t9dispatch-builder");
    const refresh = await fetch(`${base}/api/refresh`, { method: "POST" });
    assert.equal(refresh.status, 200);
    const list2 = (await (await fetch(`${base}/api/dispatch/queue`)).json()) as { entries: DispatchEntry[] };
    assert.equal(list2.entries[0]?.status, "done", "handoff evidence closes the entry to done");

    // Events log is still append-only; the creation line count is unchanged.
    const eventLines2 = readFileSync(eventsFile, "utf8").trim().split("\n");
    assert.equal(eventLines2.length, 3); // enqueued, dispatched, done
    const creationLines2 = readFileSync(queueFile, "utf8").trim().split("\n");
    assert.equal(creationLines2.length, 1);
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
    cleanup();
  }
});

test("integration: live-agent evidence marks dispatched without Lead action", async () => {
  const { repo, cleanup } = makeRepo();
  const herdrRoot = tempDir("factory-dispatch-int-herdr-live-");
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = herdrRoot;
  const service = new SnapshotService({ root: repo, noGh: true }, 60_000);
  const dispatch = new DispatchService({ snapshot: () => service.get(), factoryRoot: repo });
  const server = createApiServer(service, { webRoot: tempDir("factory-dispatch-int-web2-"), dispatch });
  try {
    const base = await listen(server);
    const prep = (await (await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    })).json()) as { requestId: string };
    await fetch(`${base}/api/dispatch/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prep.requestId }),
    });

    // A live agent matching the unit appears (simulating the Lead's dispatch).
    writeLiveAgent(herdrRoot, "t9dispatch-builder");
    await fetch(`${base}/api/refresh`, { method: "POST" });
    const list = (await (await fetch(`${base}/api/dispatch/queue`)).json()) as { entries: DispatchEntry[] };
    assert.equal(list.entries[0]?.status, "dispatched");
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
    cleanup();
  }
});

test("no-server-spawn static guarantee: dispatch module never imports child_process", async () => {
  const dir = new URL(".", import.meta.url);
  const entries = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(entries.length >= 3, "expected dispatch source modules");
  for (const file of entries) {
    const src = readFileSync(new URL(file, dir), "utf8");
    assert.ok(!src.includes("child_process"), `${file} must not spawn processes`);
    assert.ok(!/\b(execFile|spawn|fork)\s*\(/.test(src), `${file} must not spawn processes`);
  }
  // The dispatch module is the only server code that touches the queue; the
  // http route handlers only call dispatch service methods (no spawning).
  const httpSrc = readFileSync(fileURLToPath(new URL("../http.ts", dir)), "utf8");
  assert.ok(httpSrc.includes("DispatchService"));
});

test("integration/S2: per-unit dedupe over HTTP — second prepare 409; allowed after done", async () => {
  const { repo, cleanup } = makeRepo();
  const herdrRoot = tempDir("factory-dispatch-int-herdr-dedupe-");
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = herdrRoot;
  const service = new SnapshotService({ root: repo, noGh: true }, 60_000);
  const dispatch = new DispatchService({ snapshot: () => service.get(), factoryRoot: repo });
  const server = createApiServer(service, { webRoot: tempDir("factory-dispatch-int-web3-"), dispatch });
  try {
    const base = await listen(server);
    const prep = (await (await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    })).json()) as { requestId: string };
    const enq = await fetch(`${base}/api/dispatch/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prep.requestId }),
    });
    assert.equal(enq.status, 200);

    // A second prepare for the same unit is rejected (409) while active.
    const second = await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    });
    assert.equal(second.status, 409);
    const secondBody = (await second.json()) as { error: string };
    assert.match(secondBody.error, /already exists/);

    // Close the entry to done via explicit Lead transitions, then a new prepare is allowed.
    const list = (await (await fetch(`${base}/api/dispatch/queue`)).json()) as { entries: DispatchEntry[] };
    const id = list.entries[0]?.id;
    assert.ok(id);
    await fetch(`${base}/api/dispatch/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: "dispatched" }),
    });
    const done = await fetch(`${base}/api/dispatch/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    assert.equal(done.status, 200);

    const third = await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    });
    assert.equal(third.status, 200);
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
    cleanup();
  }
});

test("integration/S1: enqueue rejected (409) after the unit gains a live agent (TOCTOU)", async () => {
  const { repo, cleanup } = makeRepo();
  const herdrRoot = tempDir("factory-dispatch-int-herdr-toctou-");
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = herdrRoot;
  const service = new SnapshotService({ root: repo, noGh: true }, 60_000);
  const dispatch = new DispatchService({ snapshot: () => service.get(), factoryRoot: repo });
  const server = createApiServer(service, { webRoot: tempDir("factory-dispatch-int-web4-"), dispatch });
  try {
    const base = await listen(server);
    const prep = (await (await fetch(`${base}/api/dispatch/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unit: "T9-dispatch" }),
    })).json()) as { requestId: string; ok: boolean };
    assert.equal(prep.ok, true);

    // A live agent matching the unit appears before the Lead enqueues.
    writeLiveAgent(herdrRoot, "t9dispatch-builder");
    await fetch(`${base}/api/refresh`, { method: "POST" });

    const enq = await fetch(`${base}/api/dispatch/enqueue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: prep.requestId }),
    });
    assert.equal(enq.status, 409);
    const body = (await enq.json()) as { error: string; preconditions: { name: string; ok: boolean }[] };
    assert.match(body.error, /state changed/);
    assert.ok(body.preconditions.some((p) => p.name === "no-live-agent" && !p.ok));
  } finally {
    await close(server);
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
    cleanup();
  }
});
