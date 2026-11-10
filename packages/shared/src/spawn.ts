import type { Direction } from "./index.ts";
import { MAZE_HEIGHT, MAZE_WIDTH, isWalkableIn } from "./map.ts";

/**
 * Deterministic team spawn cells for a maze (T3). Hunters spawn near the
 * top-left/top-right corners and runners near the bottom-left/bottom-right
 * corners, each searched within its own maze quadrant.
 */

/**
 * Tunable spawn separation: each spawn search starts this many tiles in from
 * its maze corner. Larger values pull spawns toward the center (closer
 * opposing spawns); smaller values push them to the outer corridors.
 */
export const SPAWN_CORNER_INSET_TILES = 2;

export interface SpawnCell {
  col: number;
  row: number;
}

/** Index `i` is the spawn for the `i`-th member of that team (join order). */
export interface SpawnCells {
  hunter: readonly [SpawnCell, SpawnCell, SpawnCell];
  runner: readonly [SpawnCell, SpawnCell, SpawnCell];
}

const NEIGHBOR: Record<Direction, SpawnCell> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const CENTER_COL = Math.floor(MAZE_WIDTH / 2);
const CENTER_ROW = Math.floor(MAZE_HEIGHT / 2);

function hasWallNeighbor(maze: readonly string[], cell: SpawnCell): boolean {
  return Object.values(NEIGHBOR).some((delta) => !isWalkableIn(maze, cell.col + delta.col, cell.row + delta.row));
}

function nearestWalkable(
  maze: readonly string[],
  anchor: SpawnCell,
  inQuadrant: (cell: SpawnCell) => boolean,
  taken: readonly SpawnCell[],
  requireWallNeighbor: boolean,
): SpawnCell | null {
  const isFree = (cell: SpawnCell) =>
    isWalkableIn(maze, cell.col, cell.row) &&
    (!requireWallNeighbor || hasWallNeighbor(maze, cell)) &&
    !taken.some((other) => other.col === cell.col && other.row === cell.row);
  const maxRadius = Math.max(MAZE_WIDTH, MAZE_HEIGHT);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const cell = { col: anchor.col + dx, row: anchor.row + dy };
        if (inQuadrant(cell) && isFree(cell)) {
          return cell;
        }
      }
    }
  }
  return null;
}

function firstFreeCell(maze: readonly string[], taken: readonly SpawnCell[]): SpawnCell {
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    for (let col = 0; col < MAZE_WIDTH; col++) {
      if (
        isWalkableIn(maze, col, row) &&
        !taken.some((other) => other.col === col && other.row === row)
      ) {
        return { col, row };
      }
    }
  }
  throw new Error("Maze has fewer than six walkable spawn cells.");
}

/**
 * Six distinct walkable spawn cells for `maze` (three per team), deterministic
 * per maze. Hunters spawn in the top half (left, right, then center-top corner)
 * and runners in the bottom half (left, right, then center-bottom corner); the
 * third anchor lets a 3-player team spawn (e.g. 3v1). Cells with at least one
 * wall neighbor are preferred so `spawnDirection` can face a wall and players
 * start still until their first input. Throws only if the maze has fewer than
 * six walkable cells.
 */
export function findSpawnCells(
  maze: readonly string[],
  insetTiles: number = SPAWN_CORNER_INSET_TILES,
): SpawnCells {
  const left = insetTiles;
  const right = MAZE_WIDTH - 1 - insetTiles;
  const top = insetTiles;
  const bottom = MAZE_HEIGHT - 1 - insetTiles;
  const corners: Array<{ anchor: SpawnCell; inQuadrant: (cell: SpawnCell) => boolean }> = [
    { anchor: { col: left, row: top }, inQuadrant: (c) => c.col < CENTER_COL && c.row < CENTER_ROW },
    { anchor: { col: right, row: top }, inQuadrant: (c) => c.col > CENTER_COL && c.row < CENTER_ROW },
    { anchor: { col: CENTER_COL, row: top }, inQuadrant: (c) => c.row < CENTER_ROW },
    { anchor: { col: left, row: bottom }, inQuadrant: (c) => c.col < CENTER_COL && c.row > CENTER_ROW },
    { anchor: { col: right, row: bottom }, inQuadrant: (c) => c.col > CENTER_COL && c.row > CENTER_ROW },
    { anchor: { col: CENTER_COL, row: bottom }, inQuadrant: (c) => c.row > CENTER_ROW },
  ];
  const taken: SpawnCell[] = [];
  for (const { anchor, inQuadrant } of corners) {
    taken.push(
      nearestWalkable(maze, anchor, inQuadrant, taken, true) ??
        nearestWalkable(maze, anchor, inQuadrant, taken, false) ??
        firstFreeCell(maze, taken),
    );
  }
  const [hunterLeft, hunterRight, hunterCenter, runnerLeft, runnerRight, runnerCenter] = taken as [
    SpawnCell,
    SpawnCell,
    SpawnCell,
    SpawnCell,
    SpawnCell,
    SpawnCell,
  ];
  return {
    hunter: [hunterLeft, hunterRight, hunterCenter],
    runner: [runnerLeft, runnerRight, runnerCenter],
  };
}


/**
 * Initial facing for a spawn cell: the first direction (outer side first,
 * then outer edge) that faces a wall, so a player starts stationary until it
 * sends a direction. Falls back to the outer horizontal side.
 */
export function spawnDirection(maze: readonly string[], cell: SpawnCell): Direction {
  const horizontal: Direction = cell.col < CENTER_COL ? "left" : "right";
  const vertical: Direction = cell.row < CENTER_ROW ? "up" : "down";
  const candidates: Direction[] = [
    horizontal,
    vertical,
    horizontal === "left" ? "right" : "left",
    vertical === "up" ? "down" : "up",
  ];
  for (const direction of candidates) {
    const delta = NEIGHBOR[direction];
    if (!isWalkableIn(maze, cell.col + delta.col, cell.row + delta.row)) {
      return direction;
    }
  }
  return horizontal;
}
