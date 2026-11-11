import { GAME_RULES, type Team, type Direction } from "./index.ts";
import { isWalkableIn } from "./map.ts";
import type { Vec2 } from "./movement.ts";
import { CONTACT_DISTANCE_TILES } from "./round.ts";

export const PICKUP_KINDS = ["speed", "shield", "vulnerability"] as const;
export type PickupKind = typeof PICKUP_KINDS[number];
export interface PickupSnapshot {
  id: string;
  kind: PickupKind;
  col: number;
  row: number;
  active: boolean;
  nextSpawnAt: number;
}
export interface PathPoint {
  position: Vec2;
  time: number;
  direction?: Direction;
  queuedDirection?: Direction | null;
}
export type MovePath = readonly PathPoint[];
export const effectActive = (now: number, end: number): boolean => now < end;

/** Seeded stream used only by the authority, independent of message arrival. */
export function pickupRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededPriority(ids: readonly string[], random: () => number): string[] {
  const result = [...ids].sort();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Flood-fill prevents accidentally spawning on a disconnected walkable island. */
export function pickupCell(maze: readonly string[], origin: Vec2, excluded: readonly Vec2[], random: () => number): { col: number; row: number } | null {
  const queue = [{ col: Math.floor(origin.x), row: Math.floor(origin.y) }];
  const seen = new Set<string>();
  const valid: { col: number; row: number }[] = [];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const key = `${cell.col},${cell.row}`;
    if (seen.has(key) || !isWalkableIn(maze, cell.col, cell.row)) continue;
    seen.add(key);
    if (!excluded.some(p => Math.floor(p.x) === cell.col && Math.floor(p.y) === cell.row)) valid.push(cell);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) queue.push({ col: cell.col + dx, row: cell.row + dy });
  }
  return valid.length ? valid[Math.floor(random() * valid.length)]! : null;
}

export function pathPosition(path: MovePath, time: number): Vec2 {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    if (time <= b.time && b.time > a.time) {
      const t = Math.max(0, (time - a.time) / (b.time - a.time));
      return { x: a.position.x + (b.position.x - a.position.x) * t, y: a.position.y + (b.position.y - a.position.y) * t };
    }
  }
  return { ...path[path.length - 1]!.position };
}

/** First circle contact, piecewise in true movement time (including turns/wall stops). */
export function pathContact(a: MovePath, b: MovePath, distance = CONTACT_DISTANCE_TILES): number | null {
  const times = [...new Set([0, 1, ...a.map(p => p.time), ...b.map(p => p.time)])].sort((x, y) => x - y);
  for (let i = 1; i < times.length; i++) {
    const start = times[i - 1]!, end = times[i]!;
    const a0 = pathPosition(a, start), b0 = pathPosition(b, start);
    const a1 = pathPosition(a, end), b1 = pathPosition(b, end);
    const x = a0.x - b0.x, y = a0.y - b0.y;
    const vx = a1.x - b1.x - x, vy = a1.y - b1.y - y;
    const c = x * x + y * y - distance * distance;
    if (c <= 1e-12) return start;
    const v = vx * vx + vy * vy;
    const dot = x * vx + y * vy;
    const disc = dot * dot - v * c;
    if (v === 0 || disc < 0) continue;
    const t = (-dot - Math.sqrt(disc)) / v;
    if (t >= 0 && t <= 1) return start + t * (end - start);
  }
  return null;
}

/**
 * First inward protected contact. Unlike combat contact, resting/tangential or
 * separating contact does not stop motion. Check each real path segment so a
 * retreat followed by a corner cannot hide a later inward contact.
 */
export function pathBlockingContact(a: MovePath, b: MovePath, distance = CONTACT_DISTANCE_TILES): number | null {
  const times = [...new Set([0, 1, ...a.map(p => p.time), ...b.map(p => p.time)])].sort((x, y) => x - y);
  for (let i = 1; i < times.length; i++) {
    const start = times[i - 1]!, end = times[i]!;
    const a0 = pathPosition(a, start), b0 = pathPosition(b, start);
    const a1 = pathPosition(a, end), b1 = pathPosition(b, end);
    const x = a0.x - b0.x, y = a0.y - b0.y;
    const vx = a1.x - b1.x - x, vy = a1.y - b1.y - y;
    const dot = x * vx + y * vy;
    if (dot >= -1e-12) continue;
    const c = x * x + y * y - distance * distance;
    if (c <= 1e-12) return start;
    const v = vx * vx + vy * vy;
    const disc = dot * dot - v * c;
    if (disc <= 0) continue;
    const t = c / (-dot + Math.sqrt(disc));
    if (t >= 0 && t <= 1) return start + t * (end - start);
  }
  return null;
}

/** Pickup collection occurs at its cell center, not an endpoint/chord approximation. */
export function pickupArrival(path: MovePath, col: number, row: number): number | null {
  const x = col + 0.5, y = row + 0.5;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
    const lengthSquared = dx * dx + dy * dy;
    // Project onto the segment instead of solving a zero-radius quadratic:
    // its discriminant can round negative even on an exact straight crossing.
    const t = lengthSquared === 0 ? 0 : ((x - a.position.x) * dx + (y - a.position.y) * dy) / lengthSquared;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(a.position.x + t * dx - x, a.position.y + t * dy - y) <= 1e-12) {
      return a.time + t * (b.time - a.time);
    }
  }
  return null;
}
export function pickupClaim(kind: PickupKind, col: number, row: number, players: readonly { id: string; team: Team; path: MovePath }[], priority: readonly string[]): { id: string; time: number } | null {
  const claims = players.flatMap(p => {
    if (kind === "vulnerability" && p.team !== "runner") return [];
    const time = pickupArrival(p.path, col, row);
    return time === null ? [] : [{ id: p.id, time }];
  });
  claims.sort((a, b) => a.time === b.time ? priority.indexOf(a.id) - priority.indexOf(b.id) : a.time - b.time);
  return claims[0] ?? null;
}
export function pickupTiming(kind: PickupKind, now: number): { endsAt: number; nextSpawnAt: number } {
  const duration = kind === "speed" ? GAME_RULES.speedDurationMs : kind === "shield" ? GAME_RULES.shieldDurationMs : GAME_RULES.vulnerabilityDurationMs;
  const endsAt = now + duration;
  return { endsAt, nextSpawnAt: kind === "vulnerability" ? endsAt + GAME_RULES.vulnerabilityRespawnDelayMs : now + GAME_RULES.standardPickupRespawnMs };
}
export function contactOutcome(now: number, vulnerabilityEndsAt: number, hunterShieldEndsAt: number, runnerShieldEndsAt: number): "hunter" | "runner" | "blocked" {
  if (effectActive(now, vulnerabilityEndsAt) && !effectActive(now, hunterShieldEndsAt)) return "hunter";
  return effectActive(now, runnerShieldEndsAt) ? "blocked" : "runner";
}
