import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { herdrRoot, staleAfterMs } from "./config.ts";
import type { AgentRecord, HandoffRef, Lifecycle } from "./types.ts";

export interface HerdrRead {
  agents: AgentRecord[];
  handoffs: HandoffRef[];
  /** Map of result ref (e.g. `result:<uuid>`) → reservation label. */
  reservations: Map<string, string>;
  errors: string[];
}

const LIFECYCLE_BY_STATUS: Readonly<Record<string, Lifecycle>> = {
  ready: "idle",
  idle: "idle",
  working: "working",
  blocked: "blocked",
  settling: "settling",
  starting: "starting",
  done: "done",
  lost: "lost",
};

function lifecycleOf(status: unknown): Lifecycle {
  if (typeof status !== "string") return "unknown";
  return LIFECYCLE_BY_STATUS[status.toLowerCase()] ?? "unknown";
}

function readJsonFile(path: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: "not an object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function toolList(record: Record<string, unknown>): string[] {
  const value = record["availableTools"];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

/** Read live agent records from `runtime/mailboxes-v5/`. */
function readMailboxes(root: string, errors: string[]): AgentRecord[] {
  const mailboxesDir = join(root, "runtime", "mailboxes-v5");
  let entries: string[] = [];
  try {
    entries = readdirSync(mailboxesDir);
  } catch {
    return []; // no mailboxes (idle or unreadable) → no live agents
  }

  const agents: AgentRecord[] = [];
  const now = Date.now();
  const staleMs = staleAfterMs();

  for (const entry of entries.sort()) {
    const dir = join(mailboxesDir, entry);
    const statePath = join(dir, "state.json");
    const startupPath = join(dir, "startup.json");

    let state: Record<string, unknown> | undefined;
    let startup: Record<string, unknown> | undefined;
    let stateReason: string | undefined;
    const stateRead = readJsonFile(statePath);
    if (stateRead.ok) state = stateRead.value;
    else stateReason = stateRead.reason;
    const startupRead = readJsonFile(startupPath);
    if (startupRead.ok) startup = startupRead.value;
    else if (stateReason) stateReason = `${stateReason}; startup: ${startupRead.reason}`;

    if (!state) state = startup;

    const label = stringField(state ?? {}, "agentLabel") ?? stringField(state ?? {}, "agent") ?? entry;
    if (!state) {
      agents.push({
        label,
        definition: "unknown",
        state: "unknown",
        source: "mailbox",
        availableTools: [],
      });
      errors.push(`mailbox ${entry}: unreadable (${stateReason ?? "unknown"})`);
      continue;
    }

    // Prefer the richer state.json status; fall back to startup.json's.
    const status = stringField(state, "status") ?? stringField(startup ?? {}, "status") ?? stringField(state, "state");
    const record: AgentRecord = {
      label,
      definition: stringField(state, "agentDefinition") ?? stringField(state, "definition") ?? "unknown",
      state: lifecycleOf(status),
      source: "mailbox",
      availableTools: toolList(state),
    };

    const lastActivity = numberField(state, "lastActivityAt");
    if (lastActivity !== undefined) {
      record.lastActivityAt = new Date(lastActivity).toISOString();
      const inactiveMs = Math.max(0, now - lastActivity);
      record.inactiveMs = inactiveMs;
      record.stale = inactiveMs > staleMs;
    }
    const model = stringField(state, "model");
    if (model !== undefined) record.model = model;
    const thinking = boolField(state, "thinking");
    if (thinking !== undefined) record.thinking = thinking;
    const contextPct = numberField(state, "contextPct");
    if (contextPct !== undefined) record.contextPct = contextPct;

    agents.push(record);
  }

  return agents;
}

function extractJson(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Read durable handoffs from `results/`. */
function readResults(root: string, errors: string[], reservations: Map<string, string>): HandoffRef[] {
  const resultsDir = join(root, "results");
  let entries: string[] = [];
  try {
    entries = readdirSync(resultsDir);
  } catch {
    return [];
  }

  const handoffs: HandoffRef[] = [];
  for (const entry of entries.sort()) {
    const path = join(resultsDir, entry);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      handoffs.push({
        source: "unknown",
        parseError: error instanceof Error ? error.message : String(error),
      });
      errors.push(`result ${entry}: unreadable`);
      continue;
    }

    const json = extractJson(text);
    if (json === undefined) {
      handoffs.push({ source: "unknown", parseError: "no 'Agent result source' JSON header" });
      errors.push(`result ${entry}: missing JSON header`);
      continue;
    }
    let header: Record<string, unknown>;
    try {
      header = JSON.parse(json) as Record<string, unknown>;
    } catch (error) {
      handoffs.push({
        source: "unknown",
        parseError: error instanceof Error ? error.message : String(error),
      });
      errors.push(`result ${entry}: malformed JSON header`);
      continue;
    }

    const marker = text.indexOf("Agent result source:");
    const headerEnd = marker === -1 ? json.length : marker + "Agent result source:".length + json.length;
    const excerpt = text.slice(headerEnd).trim().slice(0, 240);

    const handoff: HandoffRef = { source: "result" };
    const agent = stringField(header, "agent") ?? stringField(header, "agentLabel");
    if (agent !== undefined) handoff.agent = agent;
    const definition = stringField(header, "definition");
    if (definition !== undefined) handoff.definition = definition;
    const sessionId = stringField(header, "piSessionId");
    if (sessionId !== undefined) handoff.sessionId = sessionId;
    if (excerpt !== "") handoff.excerpt = excerpt;

    // Reservation map is keyed by `result:<uuid>` (the results file basename).
    if (handoff.agent === undefined) {
      const reserved = reservations.get(`result:${entry}`) ?? reservations.get(entry);
      if (reserved !== undefined) handoff.agent = reserved;
    }

    handoffs.push(handoff);
  }
  return handoffs;
}

/** Read unit-labeled result-ref reservations (auxiliary mapping aid). */
function readReservations(root: string): Map<string, string> {
  const reservationsDir = join(root, "result-ref-reservations");
  const map = new Map<string, string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(reservationsDir);
  } catch {
    return map;
  }
  for (const label of entries.sort()) {
    const dir = join(reservationsDir, label);
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue; // entries may be plain files → skip
    }
    for (const file of files) {
      const read = readJsonFile(join(dir, file));
      if (!read.ok) continue;
      const ref = stringField(read.value, "canonicalRef");
      if (ref !== undefined) map.set(ref, label);
    }
  }
  return map;
}

/** Defensive read of the entire Herdr on-disk state. Never throws. */
export function readHerdr(): HerdrRead {
  const root = herdrRoot();
  const errors: string[] = [];
  const reservations = readReservations(root);
  const agents = readMailboxes(root, errors);
  const handoffs = readResults(root, errors, reservations);
  return { agents, handoffs, reservations, errors };
}
