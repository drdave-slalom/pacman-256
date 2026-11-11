import { homedir } from "node:os";
import { join } from "node:path";

/** Default cache lifetime for `GET /api/snapshot` (5s per spec). */
export const SNAPSHOT_CACHE_MS = 5_000;

/** A live agent is considered stale after this much inactivity. */
export const STALE_AFTER_MS = 5 * 60 * 1_000;

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function herdrRoot(): string {
  return process.env.FACTORY_HERDR_ROOT ?? join(homedir(), ".pi", "agent", "pi-herdsman");
}

export function cacheMs(): number {
  return envInt("FACTORY_CACHE_MS", SNAPSHOT_CACHE_MS);
}

export function staleAfterMs(): number {
  return envInt("FACTORY_STALE_MS", STALE_AFTER_MS);
}

export function serverHost(): string {
  return process.env.HOST ?? "127.0.0.1";
}

export function controlToken(): string | undefined {
  const token = process.env.FACTORY_CONTROL_TOKEN;
  return token !== undefined && token.trim() !== "" ? token : undefined;
}

export function serverPort(): number {
  return envInt("PORT", 4780);
}
