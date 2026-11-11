import type { Direction } from "./index.ts";
import {
  MAZE_MAP,
  PLAYER_SPAWN,
  isInsideIn,
  isWalkableIn,
} from "./map.ts";

/**
 * T2 movement module: continuous movement with buffered turns.
 *
 * Rules implemented (see docs/DECISIONS.md D018/D040 and GAME-CONTRACT.md):
 * - Movement is continuous; positions are fractional tile coordinates.
 * - A direction request queues a turn at the next legal turn point.
 * - Releasing a control does not stop movement.
 * - Movement is segmented between corridor-cell centers. A turn is re-evaluated
 *   whenever the actor reaches a center, detected by position (not by frame
 *   alignment), so small time steps never overshoot a junction and silently
 *   skip a legal turn.
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
  maze: readonly string[] = MAZE_MAP,
  path?: { position: Vec2; time: number; direction?: Direction; queuedDirection?: Direction | null }[],
): PlayerMoveState {
  const position: Vec2 = { x: state.position.x, y: state.position.y };
  let direction: Direction = state.direction;
  let queuedDirection: Direction | null = state.queuedDirection;
  const height = maze.length;
  const width = height > 0 ? maze[0]!.length : 0;

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
  const total = remaining;
  path?.push({ position: { ...position }, time: 0, direction, queuedDirection });
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
      const cellX = Math.floor(position.x);
      const atCenter = isNear(position.x, cellX + 0.5);

      // Apply a queued perpendicular turn once centered on a cell whose
      // perpendicular neighbor is walkable. Turns buffer until this point.
      if (
        queuedDirection !== null &&
        isPerpendicular(queuedDirection, direction) &&
        atCenter
      ) {
        const col = cellX;
        const dy = queuedDirection === "up" ? -1 : 1;
        if (isWalkableIn(maze, col, row + dy)) {
          position.x = col + 0.5;
          direction = queuedDirection;
          queuedDirection = null;
          continue;
        }
      }

      const nextCol = cellX + sign;
      const nextBlocked =
        !isInsideIn(width, height, nextCol, row) ||
        !isWalkableIn(maze, nextCol, row);
      // Destination center: the next center ahead when the path is open, or
      // the current cell center when blocked (never a wall boundary).
      const nextCenterX = atCenter
        ? cellX + 0.5 + sign
        : sign > 0
          ? (position.x <= cellX + 0.5 ? cellX + 0.5 : cellX + 1.5)
          : (position.x >= cellX + 0.5 ? cellX + 0.5 : cellX - 0.5);
      const stopX = nextBlocked ? cellX + 0.5 : nextCenterX;
      const distanceToDecision = Math.abs(stopX - position.x);
      if (distanceToDecision < MOVE_EPSILON) {
        break;
      }
      const advance = Math.min(remaining, distanceToDecision);
      position.x += sign * advance;
      remaining -= advance;
      path?.push({ position: { ...position }, time: (total - remaining) / total, direction, queuedDirection });
      if (advance >= distanceToDecision - MOVE_EPSILON) {
        if (nextBlocked) {
          break;
        }
        continue; // arrived at a center; re-evaluate turns
      }
      break; // ran out of time between centers
    } else {
      const col = Math.round(position.x - 0.5);
      const cellY = Math.floor(position.y);
      const atCenter = isNear(position.y, cellY + 0.5);

      if (
        queuedDirection !== null &&
        isPerpendicular(queuedDirection, direction) &&
        atCenter
      ) {
        const row = cellY;
        const dx = queuedDirection === "right" ? 1 : -1;
        if (isWalkableIn(maze, col + dx, row)) {
          position.y = row + 0.5;
          direction = queuedDirection;
          queuedDirection = null;
          continue;
        }
      }

      const nextRow = cellY + sign;
      const nextBlocked =
        !isInsideIn(width, height, col, nextRow) ||
        !isWalkableIn(maze, col, nextRow);
      const nextCenterY = atCenter
        ? cellY + 0.5 + sign
        : sign > 0
          ? (position.y <= cellY + 0.5 ? cellY + 0.5 : cellY + 1.5)
          : (position.y >= cellY + 0.5 ? cellY + 0.5 : cellY - 0.5);
      const stopY = nextBlocked ? cellY + 0.5 : nextCenterY;
      const distanceToDecision = Math.abs(stopY - position.y);
      if (distanceToDecision < MOVE_EPSILON) {
        break;
      }
      const advance = Math.min(remaining, distanceToDecision);
      position.y += sign * advance;
      remaining -= advance;
      path?.push({ position: { ...position }, time: (total - remaining) / total, direction, queuedDirection });
      if (advance >= distanceToDecision - MOVE_EPSILON) {
        if (nextBlocked) {
          break;
        }
        continue;
      }
      break;
    }
  }

  path?.push({ position: { ...position }, time: 1, direction, queuedDirection });
  return { position, direction, queuedDirection };
}
