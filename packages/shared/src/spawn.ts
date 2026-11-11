import type { Direction } from "./index.ts";
import { isWalkableIn } from "./map.ts";

/**
 * Deterministic team spawn cells for a maze (T3). Hunters spawn near the
 * top-left/top-right corners and runners near the bottom-left/bottom-right
 * corners, each searched within its own maze quadrant.
 *
 * T12: placement generalizes from a fixed 3-per-team tuple to any requested
 * count per team (default `SPAWN_MAX_PER_TEAM` = 16, matching the room cap).
 * The first three cells per team keep the original corner-quadrant behavior
 * byte-for-byte; additional cells fill the team's half deterministically from
 * a spread anchor grid, so up to 16 distinct walkable cells per team are
 * always available for the largest legal lobby.
 */

/**
 * Tunable spawn separation: each spawn search starts this many tiles in from
 * its maze corner. Larger values pull spawns toward the center (closer
 * opposing spawns); smaller values push them to the outer corridors.
 */
export const SPAWN_CORNER_INSET_TILES = 2;

/**
 * Default number of spawn cells generated per team when `findSpawnCells` is
 * called without explicit counts. This matches the expected 16v16 room
 * shape, but it is a *default*, not a hard per-team cap: callers may request
 * more (the server passes actual team sizes, so a 31v1 lobby gets 31 hunter
 * cells), and the function always returns exactly the requested count.
 */
export const SPAWN_MAX_PER_TEAM = 16;

export interface SpawnCell {
  col: number;
  row: number;
}

/** Index `i` is the spawn for the `i`-th member of that team (join order). */
export interface SpawnCells {
  hunter: readonly SpawnCell[];
  runner: readonly SpawnCell[];
}

/** Requested spawn counts and corner inset for `findSpawnCells`. */
export interface SpawnOptions {
  /** Number of hunter spawn cells to produce (default `SPAWN_MAX_PER_TEAM`). */
  hunter?: number;
  /** Number of runner spawn cells to produce (default `SPAWN_MAX_PER_TEAM`). */
  runner?: number;
  /** Corner inset in tiles (default `SPAWN_CORNER_INSET_TILES`). */
  insetTiles?: number;
}

const NEIGHBOR: Record<Direction, SpawnCell> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

function mazeDims(maze: readonly string[]): { width: number; height: number } {
  const height = maze.length;
  return { width: height > 0 ? maze[0]!.length : 0, height };
}

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
  const { width, height } = mazeDims(maze);
  const maxRadius = Math.max(width, height);
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

/** First free walkable cell in a team's half (top for hunters, bottom for runners). */
function firstFreeCellInHalf(
  maze: readonly string[],
  taken: readonly SpawnCell[],
  topHalf: boolean,
  centerRow: number,
): SpawnCell {
  const { width, height } = mazeDims(maze);
  for (let row = 0; row < height; row++) {
    if (topHalf ? row >= centerRow : row <= centerRow) {
      continue;
    }
    for (let col = 0; col < width; col++) {
      if (
        isWalkableIn(maze, col, row) &&
        !taken.some((other) => other.col === col && other.row === row)
      ) {
        return { col, row };
      }
    }
  }
  throw new Error(`Maze has fewer than the requested walkable spawn cells in ${topHalf ? "the top" : "the bottom"} half.`);
}

/**
 * Deterministic anchor grid spanning a team's half, used to place spawns past
 * the original three corner cells. Anchors cover the half with roughly
 * `sqrt(count)` rows and columns so the resulting cells spread across it.
 */
function extraAnchors(
  topHalf: boolean,
  count: number,
  width: number,
  height: number,
  inset: number,
  centerRow: number,
): SpawnCell[] {
  const left = inset;
  const right = width - 1 - inset;
  const minRow = topHalf ? 1 : centerRow + 1;
  const maxRow = topHalf ? centerRow - 1 : height - 2;
  const rowSpan = maxRow - minRow + 1;
  const colSpan = right - left + 1;
  const colTarget = Math.max(3, Math.ceil(Math.sqrt(count)));
  const rowTarget = Math.max(3, Math.ceil(count / colTarget));
  const colStep = Math.max(1, Math.floor(colSpan / (colTarget - 1)));
  const rowStep = Math.max(1, Math.floor(rowSpan / (rowTarget - 1)));
  const anchors: SpawnCell[] = [];
  for (let row = minRow; row <= maxRow; row += rowStep) {
    for (let col = left; col <= right; col += colStep) {
      anchors.push({ col, row });
    }
  }
  return anchors;
}

type Half = "top" | "bottom";

/**
 * Distinct walkable spawn cells for `maze`, deterministic per maze and count.
 * Hunters spawn in the top half, runners in the bottom half, spreading outward
 * from the corners. Cells with at least one wall neighbor are preferred so
 * `spawnDirection` can face a wall and players start still until their first
 * input. Each team gets exactly the requested number of distinct cells (default
 * 16), so callers can never index past the returned array for a legal lobby.
 */
export function findSpawnCells(
  maze: readonly string[],
  options: SpawnOptions | number = {},
): SpawnCells {
  const opts = typeof options === "number" ? { insetTiles: options } : options;
  const inset = opts.insetTiles ?? SPAWN_CORNER_INSET_TILES;
  const counts = {
    hunter: Math.max(1, opts.hunter ?? SPAWN_MAX_PER_TEAM),
    runner: Math.max(1, opts.runner ?? SPAWN_MAX_PER_TEAM),
  };
  const { width, height } = mazeDims(maze);
  const centerCol = Math.floor(width / 2);
  const centerRow = Math.floor(height / 2);
  const left = inset;
  const right = width - 1 - inset;
  const top = inset;
  const bottom = height - 1 - inset;

  // Original corner anchors (T3): TL/TR/top-center for hunters, BL/BR/bottom-
  // center for runners, each searched within its own quadrant. Keeping these
  // first preserves the pre-T12 spawn placement byte-for-byte for small teams.
  const legacyAnchors: Array<{
    side: "hunter" | "runner";
    anchor: SpawnCell;
    inQuadrant: (cell: SpawnCell) => boolean;
  }> = [
    { side: "hunter", anchor: { col: left, row: top }, inQuadrant: (c) => c.col < centerCol && c.row < centerRow },
    { side: "hunter", anchor: { col: right, row: top }, inQuadrant: (c) => c.col > centerCol && c.row < centerRow },
    { side: "hunter", anchor: { col: centerCol, row: top }, inQuadrant: (c) => c.row < centerRow },
    { side: "runner", anchor: { col: left, row: bottom }, inQuadrant: (c) => c.col < centerCol && c.row > centerRow },
    { side: "runner", anchor: { col: right, row: bottom }, inQuadrant: (c) => c.col > centerCol && c.row > centerRow },
    { side: "runner", anchor: { col: centerCol, row: bottom }, inQuadrant: (c) => c.row > centerRow },
  ];

  const halfOf = (side: "hunter" | "runner"): Half => (side === "hunter" ? "top" : "bottom");
  const inHalf = (side: "hunter" | "runner") => (cell: SpawnCell): boolean =>
    (halfOf(side) === "top" ? cell.row < centerRow : cell.row > centerRow);

  const taken: SpawnCell[] = [];
  const result: Record<"hunter" | "runner", SpawnCell[]> = { hunter: [], runner: [] };

  const place = (side: "hunter" | "runner", anchor: SpawnCell, inQuadrant: (cell: SpawnCell) => boolean): void => {
    const cell =
      nearestWalkable(maze, anchor, inQuadrant, taken, true) ??
      nearestWalkable(maze, anchor, inQuadrant, taken, false) ??
      firstFreeCellInHalf(maze, taken, halfOf(side) === "top", centerRow);
    result[side].push(cell);
    taken.push(cell);
  };

  for (const { side, anchor, inQuadrant } of legacyAnchors) {
    if (result[side].length < counts[side]) {
      place(side, anchor, inQuadrant);
    }
  }

  for (const side of ["hunter", "runner"] as const) {
    while (result[side].length < counts[side]) {
      const before = result[side].length;
      const anchors = extraAnchors(halfOf(side) === "top", counts[side], width, height, inset, centerRow);
      for (const anchor of anchors) {
        if (result[side].length >= counts[side]) {
          break;
        }
        place(side, anchor, inHalf(side));
      }
      if (result[side].length === before) {
        // Anchor searches found no additional free cell; fill from the half scan.
        const cell = firstFreeCellInHalf(maze, taken, halfOf(side) === "top", centerRow);
        result[side].push(cell);
        taken.push(cell);
      }
    }
  }

  return { hunter: result.hunter, runner: result.runner };
}

/**
 * Initial facing for a spawn cell: the first direction (outer side first,
 * then outer edge) that faces a wall, so a player starts stationary until it
 * sends a direction. Falls back to the outer horizontal side.
 */
export function spawnDirection(maze: readonly string[], cell: SpawnCell): Direction {
  const { width, height } = mazeDims(maze);
  const centerCol = Math.floor(width / 2);
  const centerRow = Math.floor(height / 2);
  const horizontal: Direction = cell.col < centerCol ? "left" : "right";
  const vertical: Direction = cell.row < centerRow ? "up" : "down";
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
