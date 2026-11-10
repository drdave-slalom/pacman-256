import type { Team } from "./index.ts";
import type { Vec2 } from "./movement.ts";

/** Hunter/runner contact range, in tiles (center-to-center). */
export const CONTACT_DISTANCE_TILES = 0.6;

export type ResultReason = "teamEliminated" | "timeout" | "simultaneousWipe" | "abandoned";
export type ResultWinner = Team | "none";

/**
 * True if two players moving linearly from `*From` to `*To` over the same
 * interval t∈[0,1] come within `distance` tiles of each other (inclusive).
 * Uses the closest approach of the relative motion, so fast crossings and
 * head-on swaps within one step are not missed.
 */
export function sweptContact(
  aFrom: Vec2,
  aTo: Vec2,
  bFrom: Vec2,
  bTo: Vec2,
  distance = CONTACT_DISTANCE_TILES,
): boolean {
  // A corner turn within one step is approximated by the straight from→to segment.
  // Relative position p(t) = p0 + v·t.
  const p0x = bFrom.x - aFrom.x;
  const p0y = bFrom.y - aFrom.y;
  const vx = bTo.x - aTo.x - p0x;
  const vy = bTo.y - aTo.y - p0y;
  const vv = vx * vx + vy * vy;
  const t = vv === 0 ? 0 : Math.min(1, Math.max(0, -(p0x * vx + p0y * vy) / vv));
  const dx = p0x + vx * t;
  const dy = p0y + vy * t;
  return dx * dx + dy * dy <= distance * distance;
}

/**
 * Decide whether a round ends after a simulation step. `*AliveBefore` are the
 * counts at step start (after disconnects). In order: both teams
 * already empty at step start → `none/abandoned`; both emptied this step →
 * `none/simultaneousWipe`; no runners → `hunter/teamEliminated`; no hunters →
 * `runner/teamEliminated`; deadline reached with both alive → `runner/timeout`;
 * otherwise `null` (round continues).
 */
export function evaluateRoundOutcome(input: {
  huntersAlive: number;
  runnersAlive: number;
  huntersAliveBefore: number;
  runnersAliveBefore: number;
  deadlineReached: boolean;
}): { winner: ResultWinner; reason: ResultReason } | null {
  const { huntersAlive, runnersAlive, huntersAliveBefore, runnersAliveBefore, deadlineReached } = input;
  if (huntersAliveBefore === 0 && runnersAliveBefore === 0) {
    return { winner: "none", reason: "abandoned" };
  }
  if (huntersAlive === 0 && runnersAlive === 0) {
    return { winner: "none", reason: "simultaneousWipe" };
  }
  if (runnersAlive === 0) {
    return { winner: "hunter", reason: "teamEliminated" };
  }
  if (huntersAlive === 0) {
    return { winner: "runner", reason: "teamEliminated" };
  }
  if (deadlineReached) {
    return { winner: "runner", reason: "timeout" };
  }
  return null;
}
