/**
 * M2 append-only audit log.
 *
 * Every prepare/execute writes one JSONL line to
 * `factory-control/state/audit.log.jsonl` (server-owned, gitignored). The log
 * is append-only: the writer never truncates or rewrites existing lines.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Precondition } from "./types.ts";

export interface AuditLine {
  at: string;
  action: string;
  requestId: string;
  operator: string;
  ip?: string;
  unit?: string;
  pr?: number;
  preconditions: Precondition[];
  outcome: "prepared" | "success" | "failed" | "rejected";
  exit?: number;
}

export interface AuditLogOptions {
  file: string;
  clock?: () => Date;
}

export class AuditLog {
  private readonly file: string;
  private readonly now: () => Date;

  constructor(opts: AuditLogOptions) {
    this.file = opts.file;
    this.now = opts.clock ?? (() => new Date());
  }

  append(line: Omit<AuditLine, "at">): AuditLine {
    const full: AuditLine = { at: this.now().toISOString(), ...line };
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(full) + "\n", "utf8");
    return full;
  }

  /** Return the most recent `limit` parseable lines (newest last). */
  recent(limit: number): AuditLine[] {
    let text = "";
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    const start = Math.max(0, lines.length - limit);
    const out: AuditLine[] = [];
    for (const line of lines.slice(start)) {
      try {
        out.push(JSON.parse(line) as AuditLine);
      } catch {
        // A malformed trailing line must not break the read path.
      }
    }
    return out;
  }
}
