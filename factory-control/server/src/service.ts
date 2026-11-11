import { cacheMs } from "./config.ts";
import { buildSnapshot, type SnapshotOptions } from "./snapshot.ts";
import type { FactorySnapshot } from "./types.ts";

/**
 * Snapshot cache. `GET /api/snapshot` serves a cached snapshot for ≤5s;
 * `POST /api/refresh` forces a re-read.
 */
export class SnapshotService {
  private readonly opts: SnapshotOptions;
  private readonly ttlMs: number;
  private snapshot: FactorySnapshot | null = null;
  private at = 0;

  constructor(opts: SnapshotOptions, ttlMs: number = cacheMs()) {
    this.opts = opts;
    this.ttlMs = ttlMs;
  }

  async get(force = false): Promise<FactorySnapshot> {
    const now = Date.now();
    if (!force && this.snapshot !== null && now - this.at < this.ttlMs) {
      return this.snapshot;
    }
    const snap = await buildSnapshot(this.opts);
    this.snapshot = snap;
    this.at = now;
    return snap;
  }

  lastGeneratedAt(): string | null {
    return this.snapshot?.generatedAt ?? null;
  }
}
