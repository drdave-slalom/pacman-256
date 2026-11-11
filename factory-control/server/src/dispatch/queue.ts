/**
 * M4 dispatch queue (append-only JSONL).
 *
 * The queue lives at `factory-control/state/dispatch-queue/` and is
 * gitignored. It is machine-readable by the TUI extension and the CLI.
 *
 * Append-only honesty:
 * - `queue.jsonl` records every enqueued entry exactly once (one JSONL line
 *   per entry, initial status `queued`). Lines are never rewritten or
 *   removed.
 * - `events.jsonl` records every status transition as an append-only event
 *   (`{id, at, status}`).
 * - An entry's current status is derived by replaying the event log over the
 *   creation line, so history is never lost.
 *
 * Status transitions are strict: `queued → dispatched → done/cancelled`
 * (a `queued` entry may also be cancelled). Reversals and resurrecting a
 * terminal entry are rejected. The `evidence` path is the only place that may
 * move `queued → done` directly (the work demonstrably happened before the
 * Lead marked it dispatched).
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DISPATCH_STATUSES, type DispatchEntry, type DispatchStatus } from "./types.ts";

export interface DispatchQueueOptions {
  dir: string;
  clock?: () => Date;
}

interface QueueEvent {
  id: string;
  at: string;
  status: DispatchStatus;
}

const ALLOWED_EXPLICIT: Record<DispatchStatus, ReadonlySet<DispatchStatus>> = {
  queued: new Set(["dispatched", "cancelled"]),
  dispatched: new Set(["done", "cancelled"]),
  done: new Set(),
  cancelled: new Set(),
};

function parseLine<T>(line: string): T | undefined {
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

export class DispatchQueue {
  private readonly dir: string;
  private readonly file: string;
  private readonly eventsFile: string;
  private readonly now: () => Date;

  constructor(opts: DispatchQueueOptions) {
    this.dir = opts.dir;
    this.file = join(opts.dir, "queue.jsonl");
    this.eventsFile = join(opts.dir, "events.jsonl");
    this.now = opts.clock ?? (() => new Date());
  }

  /** Append a new entry (write-once; every enqueue appends one line). */
  append(entry: Omit<DispatchEntry, "status"> & { status?: DispatchStatus }): DispatchEntry {
    const full: DispatchEntry = { status: "queued", ...entry };
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file, JSON.stringify(full) + "\n", "utf8");
    this.recordEvent(full.id, full.status);
    return full;
  }

  /** All entries in creation order (newest last), with replayed statuses. */
  list(): DispatchEntry[] {
    const byId = new Map<string, DispatchEntry>();
    let text = "";
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    for (const raw of text.split(/\r?\n/)) {
      if (raw.trim() === "") continue;
      const entry = parseLine<DispatchEntry>(raw);
      if (entry === undefined || typeof entry.id !== "string") continue;
      // First line for an id wins (creation); duplicate lines are ignored.
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }

    let eventsText = "";
    try {
      eventsText = readFileSync(this.eventsFile, "utf8");
    } catch {
      // No events yet → everything is queued.
    }
    for (const raw of eventsText.split(/\r?\n/)) {
      if (raw.trim() === "") continue;
      const event = parseLine<QueueEvent>(raw);
      if (event === undefined) continue;
      const entry = byId.get(event.id);
      if (entry === undefined) continue;
      if (DISPATCH_STATUSES.includes(event.status)) entry.status = event.status;
    }
    return [...byId.values()];
  }

  find(id: string): DispatchEntry | undefined {
    return this.list().find((entry) => entry.id === id);
  }

  /**
   * True when an entry for the unit is still active (queued or dispatched).
   * Done/cancelled entries are terminal and do not block a new request.
   */
  hasActive(unit: string): boolean {
    return this.list().some(
      (entry) => entry.unit === unit && (entry.status === "queued" || entry.status === "dispatched"),
    );
  }

  /**
   * Explicit Lead transition. Only the strict chain is allowed; same-status
   * updates are idempotent no-ops.
   */
  transition(
    id: string,
    next: DispatchStatus,
  ): { ok: true; entry: DispatchEntry } | { ok: false; reason: string } {
    const entry = this.find(id);
    if (entry === undefined) return { ok: false, reason: "no such queue entry" };
    if (entry.status === next) return { ok: true, entry };
    const allowed = ALLOWED_EXPLICIT[entry.status];
    if (allowed === undefined || !allowed.has(next)) {
      return { ok: false, reason: `invalid transition ${entry.status} → ${next}` };
    }
    this.recordEvent(id, next);
    return { ok: true, entry: { ...entry, status: next } };
  }

  /**
   * Snapshot-evidence transition (server-side automation only). Moves
   * `queued → dispatched`, `queued → done`, and `dispatched → done`. Never
   * cancels, reverses, or resurrects a terminal entry.
   */
  evidence(id: string, next: DispatchStatus): { changed: boolean; entry: DispatchEntry } {
    const entry = this.find(id);
    if (entry === undefined) return { changed: false, entry: undefined as unknown as DispatchEntry };
    if (entry.status === next) return { changed: false, entry };
    // Evidence only moves forward to dispatched/done — never cancel, reverse,
    // or resurrect a terminal entry.
    if (next !== "dispatched" && next !== "done") return { changed: false, entry };
    const forward = entry.status === "queued" || (entry.status === "dispatched" && next === "done");
    if (!forward) return { changed: false, entry };
    this.recordEvent(id, next);
    return { changed: true, entry: { ...entry, status: next } };
  }

  private recordEvent(id: string, status: DispatchStatus): void {
    appendFileSync(
      this.eventsFile,
      JSON.stringify({ id, at: this.now().toISOString(), status } as QueueEvent) + "\n",
      "utf8",
    );
  }
}
