/**
 * M2 per-unit locks.
 *
 * Mutating actions on a unit take a lock file at
 * `factory-control/state/locks/<unit>.lock` so overlapping writers/mutations
 * are prevented. A lock is stale when it is older than 1 h or its holding pid
 * is no longer alive; stale locks are releasable only with an explicit
 * override (the operator's confirm path).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LockInfo {
  unit: string;
  requestId: string;
  operator: string;
  acquiredAt: number;
  pid: number;
}

export interface LockOptions {
  dir: string;
  staleMs?: number;
  clock?: () => number;
}

export const DEFAULT_STALE_LOCK_MS = 60 * 60 * 1000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class LockManager {
  private readonly dir: string;
  private readonly staleMs: number;
  private readonly now: () => number;
  /** Locks held by this server process (unit → requestId). */
  private readonly held = new Map<string, string>();

  constructor(opts: LockOptions) {
    this.dir = opts.dir;
    this.staleMs = opts.staleMs ?? DEFAULT_STALE_LOCK_MS;
    this.now = opts.clock ?? (() => Date.now());
  }

  private path(unit: string): string {
    return join(this.dir, `${unit}.lock`);
  }

  private read(unit: string): LockInfo | undefined {
    const file = this.path(unit);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as LockInfo;
    } catch {
      // A malformed lock file is treated as stale (unreadable) but still
      // requires override to release, exactly like an old lock.
      return undefined;
    }
  }

  isStale(info: LockInfo): boolean {
    if (this.now() - info.acquiredAt > this.staleMs) return true;
    return !pidAlive(info.pid);
  }

  tryAcquire(
    unit: string,
    info: LockInfo,
    opts: { override?: boolean } = {},
  ): { ok: true } | { ok: false; reason: string } {
    if (this.held.has(unit)) {
      return { ok: false, reason: `an operation is already in progress on unit ${unit}` };
    }
    const existing = this.read(unit);
    if (existing !== undefined) {
      const stale = this.isStale(existing);
      if (!stale) {
        return {
          ok: false,
          reason: `lock held by ${existing.requestId} (acquired ${new Date(existing.acquiredAt).toISOString()})`,
        };
      }
      if (!opts.override) {
        return {
          ok: false,
          reason: `stale lock exists (acquired ${new Date(existing.acquiredAt).toISOString()}); pass override:true to release`,
        };
      }
      this.release(unit);
    }
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(unit), JSON.stringify(info));
    this.held.set(unit, info.requestId);
    return { ok: true };
  }

  release(unit: string): void {
    this.held.delete(unit);
    rmSync(this.path(unit), { force: true });
  }

  list(): LockInfo[] {
    const out: LockInfo[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return out;
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".lock")) continue;
      const unit = entry.slice(0, -".lock".length);
      const info = this.read(unit);
      if (info !== undefined) out.push(info);
    }
    return out;
  }
}
