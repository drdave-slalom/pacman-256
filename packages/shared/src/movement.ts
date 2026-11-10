import type { Direction } from "./index.ts";
import { PLAYER_SPAWN, isInside, isWalkable } from "./map.ts";

/**
 * T2 movement module: continuous movement with buffered turns.
 *
 * Rules implemented (see docs/DECISIONS.md D018/D040 and GAME-CONTRACT.md):
 * - Movement is continuous; positions are fractional tile coordinates.
 * - A direction request queues a turn at the next legal turn point.
 * - Releasing a control does not stop movement.
 * - Walls block: a move that would enter a wall cell (or leave the maze)
 *   stops centered in the current walkable corridor cell, so the actor never
 *   rests on a tile boundary (integer coordinate) and never enters a wall.
 * - A queued perpendicular direction is applied at a junction/turn point when
 *   it becomes legal (centered on a cell whose perpendicular neighbor is
 *   walkable). No frame-perfect timing is required.
 * - Pressing the opposite direction reverses immediately; pressing the same
 *   direction is a no-op.
 * - When blocked ahead, the actor stops and resumes when a direction becomes
 *   legal (a perpendicular turn or a reversal).
 * - Deterministic: no randomness, no time dependence other than dt.
 */

/** Starting point for tuning: ~4 tiles per second. */
export const DEFAULT_MOVE_SPEED_TILES_PER_SECOND = 4;

const MOVE_EPSILON = 1e-6;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerMoveState {
  position: Vec2;
  direction: Direction;
  queuedDirection: Direction | null;
}

const DIRECTION_DELTA: Record<Direction, Readonly<Vec2>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function isOpposite(a: Direction, b: Direction): boolean {
  const da = DIRECTION_DELTA[a];
  const db = DIRECTION_DELTA[b];
  return da.x === -db.x && da.y === -db.y;
}

function isPerpendicular(a: Direction, b: Direction): boolean {
  const da = DIRECTION_DELTA[a];
  const db = DIRECTION_DELTA[b];
  return da.x * db.x + da.y * db.y === 0;
}

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) < MOVE_EPSILON;
}

export function createPlayerMoveState(
  spawn: Readonly<{ col: number; row: number }> = PLAYER_SPAWN,
  direction: Direction = "left",
): PlayerMoveState {
  return {
    position: { x: spawn.col + 0.5, y: spawn.row + 0.5 },
    direction,
    queuedDirection: null,
  };
}

export function stepPlayerMove(
  state: PlayerMoveState,
  speedTilesPerSecond: number,
  dtSeconds: number,
): PlayerMoveState {
  const position: Vec2 = { x: state.position.x, y: state.position.y };
  let direction: Direction = state.direction;
  let queuedDirection: Direction | null = state.queuedDirection;

  // Immediate input semantics: same direction is a no-op, opposite reverses
  // right away (even at zero movement), perpendicular stays buffered.
  if (queuedDirection !== null) {
    if (queuedDirection === direction) {
      queuedDirection = null;
    } else if (isOpposite(queuedDirection, direction)) {
      direction = queuedDirection;
      queuedDirection = null;
    }
  }

  let remaining = Math.max(0, speedTilesPerSecond) * Math.max(0, dtSeconds);
  if (remaining <= 0) {
    return { position, direction, queuedDirection };
  }

  while (remaining > 0) {
    const horizontal = direction === "left" || direction === "right";
    const sign = horizontal
      ? direction === "right"
        ? 1
        : -1
      : direction === "down"
        ? 1
        : -1;

    if (horizontal) {
      const row = Math.round(position.y - 0.5);

      // Try a queued perpendicular turn at a cell center (junction) where the
      // perpendicular neighbor is walkable (the boundary branch below is
      // retained defensively for legacy boundary positions).
      if (queuedDirection !== null && isPerpendicular(queuedDirection, direction)) {
        const dy = queuedDirection === "up" ? -1 : 1;
        const groundedX = Math.round(position.x);
        const atCenter = isNear(position.x, Math.floor(position.x) + 0.5);
        const atBoundary = isNear(position.x, groundedX);
        let turnCol: number | null = null;
        if (atCenter) {
          const col = Math.floor(position.x);
          if (isWalkable(col, row + dy)) {
            turnCol = col;
          }
        } else if (atBoundary) {
          const col = sign > 0 ? groundedX - 1 : groundedX;
          if (isWalkable(col, row + dy)) {
            turnCol = col;
          }
        }
        if (turnCol !== null) {
          position.x = turnCol + 0.5;
          direction = queuedDirection;
          queuedDirection = null;
          continue;
        }
      }

      const nextCellCol = Math.floor(position.x) + sign;
      const nextBlocked = !isInside(nextCellCol, row) || !isWalkable(nextCellCol, row);
      const nextCenterX = Math.floor(position.x) + 0.5 + sign;
      const blockedCenterX =
        (sign > 0 ? Math.floor(position.x - MOVE_EPSILON) : Math.floor(position.x)) + 0.5;
      const moveLimitX = nextBlocked ? blockedCenterX : nextCenterX;
      const distanceToDecision = Math.abs(moveLimitX - position.x);
      if (distanceToDecision < MOVE_EPSILON) {
        break;
      }
      const advance = Math.min(remaining, distanceToDecision);
      position.x += sign * advance;
      remaining -= advance;
      if (nextBlocked && advance >= distanceToDecision - MOVE_EPSILON) {
        break;
      }
    } else {
      const col = Math.round(position.x - 0.5);

      if (queuedDirection !== null && isPerpendicular(queuedDirection, direction)) {
        const dx = queuedDirection === "right" ? 1 : -1;
        const groundedY = Math.round(position.y);
        const atCenter = isNear(position.y, Math.floor(position.y) + 0.5);
        const atBoundary = isNear(position.y, groundedY);
        let turnRow: number | null = null;
        if (atCenter) {
          const row = Math.floor(position.y);
          if (isWalkable(col + dx, row)) {
            turnRow = row;
          }
        } else if (atBoundary) {
          const row = sign > 0 ? groundedY - 1 : groundedY;
          if (isWalkable(col + dx, row)) {
            turnRow = row;
          }
        }
        if (turnRow !== null) {
          position.y = turnRow + 0.5;
          direction = queuedDirection;
          queuedDirection = null;
          continue;
        }
      }

      const nextCellRow = Math.floor(position.y) + sign;
      const nextBlocked = !isInside(col, nextCellRow) || !isWalkable(col, nextCellRow);
      const nextCenterY = Math.floor(position.y) + 0.5 + sign;
      const blockedCenterY =
        (sign > 0 ? Math.floor(position.y - MOVE_EPSILON) : Math.floor(position.y)) + 0.5;
      const moveLimitY = nextBlocked ? blockedCenterY : nextCenterY;
      const distanceToDecision = Math.abs(moveLimitY - position.y);
      if (distanceToDecision < MOVE_EPSILON) {
        break;
      }
      const advance = Math.min(remaining, distanceToDecision);
      position.y += sign * advance;
      remaining -= advance;
      if (nextBlocked && advance >= distanceToDecision - MOVE_EPSILON) {
        break;
      }
    }
  }

  return { position, direction, queuedDirection };
}
