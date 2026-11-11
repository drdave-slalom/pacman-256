import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readHerdr } from "./herdr.ts";

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "factory-herdr-"));
  mkdirSync(join(root, "runtime", "mailboxes-v5"), { recursive: true });
  mkdirSync(join(root, "results"), { recursive: true });
  mkdirSync(join(root, "result-ref-reservations"), { recursive: true });
  return root;
}

test("reads live mailbox agents with lifecycle vocabulary", () => {
  const root = fixtureRoot();
  const agentDir = join(root, "runtime", "mailboxes-v5", "agent-a");
  mkdirSync(agentDir);
  writeFileSync(
    join(agentDir, "state.json"),
    JSON.stringify({
      version: 5,
      agentLabel: "agent-a",
      agentDefinition: "builder",
      status: "working",
      lastActivityAt: Date.now(),
      availableTools: ["read", "bash"],
    }),
  );

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const read = readHerdr();
    assert.equal(read.agents.length, 1);
    const agent = read.agents[0]!;
    assert.equal(agent.label, "agent-a");
    assert.equal(agent.definition, "builder");
    assert.equal(agent.state, "working");
    assert.deepEqual(agent.availableTools, ["read", "bash"]);
    assert.equal(agent.source, "mailbox");
    assert.equal(typeof agent.lastActivityAt, "string");
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("mailbox 'ready' status maps to idle lifecycle", () => {
  const root = fixtureRoot();
  const agentDir = join(root, "runtime", "mailboxes-v5", "agent-b");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "startup.json"), JSON.stringify({ version: 5, agentLabel: "agent-b", status: "ready" }));

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const agent = readHerdr().agents[0]!;
    assert.equal(agent.state, "idle");
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("malformed mailbox record degrades to unknown, never crashes", () => {
  const root = fixtureRoot();
  const agentDir = join(root, "runtime", "mailboxes-v5", "broken-agent");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "state.json"), "{ not json");

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const read = readHerdr();
    const agent = read.agents[0]!;
    assert.equal(agent.state, "unknown");
    assert.ok(read.errors.some((error) => error.includes("broken-agent")));
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("reads result handoffs with session metadata", () => {
  const root = fixtureRoot();
  const body = [
    'Agent result source: {"agent":"t6-review","definition":"pr-reviewer","cwd":"/tmp","piSessionId":"sess-1"}',
    "",
    "Review complete.",
    "",
  ].join("\n");
  writeFileSync(join(root, "results", "0001-aaaa"), body);

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const read = readHerdr();
    assert.equal(read.handoffs.length, 1);
    const handoff = read.handoffs[0]!;
    assert.equal(handoff.agent, "t6-review");
    assert.equal(handoff.definition, "pr-reviewer");
    assert.equal(handoff.sessionId, "sess-1");
    assert.ok(handoff.excerpt?.includes("Review complete."));
    assert.equal(handoff.source, "result");
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("malformed result file degrades to an unknown row, never crashes", () => {
  const root = fixtureRoot();
  writeFileSync(join(root, "results", "0002-bbbb"), "no json header here");

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const read = readHerdr();
    const handoff = read.handoffs[0]!;
    assert.equal(handoff.source, "unknown");
    assert.ok(handoff.parseError);
    assert.ok(read.errors.some((error) => error.includes("0002-bbbb")));
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("missing Herdr state degrades gracefully (no crash, empty read)", () => {
  const root = join(tmpdir(), "factory-herdr-does-not-exist-" + Date.now());
  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const read = readHerdr();
    assert.deepEqual(read.agents, []);
    assert.deepEqual(read.handoffs, []);
    assert.equal(read.reservations.size, 0);
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});

test("result-ref reservations enrich handoffs that lost their label", () => {
  const root = fixtureRoot();
  const uuid = "uuid-1234";
  writeFileSync(join(root, "results", uuid), 'Agent result source: {"definition":"pr-reviewer","piSessionId":"sess-2"}\n\nDone.\n');
  mkdirSync(join(root, "result-ref-reservations", "t4-review"));
  writeFileSync(
    join(root, "result-ref-reservations", "t4-review", "1"),
    JSON.stringify({ version: 1, canonicalRef: `result:${uuid}` }),
  );

  const previous = process.env.FACTORY_HERDR_ROOT;
  process.env.FACTORY_HERDR_ROOT = root;
  try {
    const handoff = readHerdr().handoffs[0]!;
    assert.equal(handoff.agent, "t4-review");
  } finally {
    if (previous === undefined) delete process.env.FACTORY_HERDR_ROOT;
    else process.env.FACTORY_HERDR_ROOT = previous;
  }
});
