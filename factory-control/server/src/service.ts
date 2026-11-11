import { cacheMs } from "./config.ts";
import { buildSnapshot, type SnapshotOptions } from "./snapshot.ts";
import type { FactorySnapshot } from "./types.ts";

export type SnapshotBuilder = (opts: SnapshotOptions) => Promise<FactorySnapshot>;

/**
 * Snapshot cache. `GET /api/snapshot` serves a cached snapshot for ≤5s;
 * `POST /api/refresh` forces a re-read.
 *
 * Non-blocking: snapshot builds run fully asynchronously (never sync child
 * spawns) and are coalesced — at most one build is in flight at a time.
 * When the cache is stale, a non-forced read serves the stale snapshot
 * immediately and refreshes in the background; a forced read (or a cold
 * start) joins the single shared in-flight build.
 */
export class SnapshotService {
  private readonly opts: SnapshotOptions;
  private readonly ttlMs: number;
  private readonly build: SnapshotBuilder;
  private snapshot: FactorySnapshot | null = null;
  private at = 0;
  private inflight: Promise<FactorySnapshot> | null = null;

  constructor(opts: SnapshotOptions, ttlMs: number = cacheMs(), build: SnapshotBuilder = buildSnapshot) {
    this.opts = opts;
    this.ttlMs = ttlMs;
    this.build = build;
  }

  async get(force = false): Promise<FactorySnapshot> {
    const now = Date.now();
    if (!force && this.snapshot !== null && now - this.at < this.ttlMs) {
      return this.snapshot;
    }
    // Stale cache, non-forced: serve it immediately; refresh in the background
    // (coalesced — joins any build already in flight).
    if (!force && this.snapshot !== null) {
      this.ensureBuild();
      return this.snapshot;
    }
    // Forced or cold start: join/start the shared build and await it.
    this.ensureBuild();
    const inflight = this.inflight;
    if (inflight === null) {
      // Defensive: ensureBuild always installs an in-flight build.
      return this.build(this.opts);
    }
    return inflight;
  }

  lastGeneratedAt(): string | null {
    return this.snapshot?.generatedAt ?? null;
  }

  private ensureBuild(): void {
    if (this.inflight !== null) return;
    const promise = this.build(this.opts);
    this.inflight = promise;
    promise.then(
      (snap) => {
        this.snapshot = snap;
        this.at = Date.now();
      },
      () => {},
    ).then(() => {
      if (this.inflight === promise) this.inflight = null;
    });
  }
}
