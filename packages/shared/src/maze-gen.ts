import {
  MAZE_HEIGHT,
  MAZE_MAP,
  MAZE_WIDTH,
  isWalkableIn,
} from "./map.ts";

/**
 * Seeded, deterministic maze generation for the T2 prototype.
 *
 * Generates dense, loop-rich, reference-style corridor mazes on the fixed
 * 21x19 canvas: full border walls, one-tile corridors, horizontal runs on
 * every odd row, and vertical connectors on even columns (mirrored across
 * both the center column and center row). The same seed always produces the
 * same maze, so the authoritative server (T3+) can regenerate the identical
 * map from a shared seed. `MAZE_MAP` remains the static default/fallback.
 */

const WALL = "#";
const FLOOR = ".";

/** Deterministic PRNG (mulberry32). Returns a function yielding [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ODD_ROWS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
/** Even columns that may carry vertical connectors (mirrored pairs + center). */
const CONNECTOR_COLS = [2, 4, 6, 8, 10, 12, 14, 16, 18];
const CONNECTOR_PAIRS: Array<[number, number]> = [
  [4, 16],
  [6, 14],
  [8, 12],
];
const CENTER_COL = 10;
/** Outer perimeter columns, always open vertically so every row loops around. */
const RING_CONNECTOR_COLS = [1, 19] as const;
const CONNECTOR_PROBABILITY = 0.6;

function blankMaze(): string[] {
  const rows: string[] = [];
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    let line = "";
    for (let col = 0; col < MAZE_WIDTH; col++) {
      const border = row === 0 || row === MAZE_HEIGHT - 1 || col === 0 || col === MAZE_WIDTH - 1;
      line += border ? WALL : WALL;
    }
    rows.push(line);
  }
  return rows;
}

function setCell(maze: string[], col: number, row: number, ch: string): void {
  const line = maze[row];
  if (line === undefined) {
    return;
  }
  maze[row] = line.slice(0, col) + ch + line.slice(col + 1);
}

function isFloor(maze: readonly string[], col: number, row: number): boolean {
  return isWalkableIn(maze, col, row) && maze[row]?.charAt(col) === FLOOR;
}

function validateMaze(maze: readonly string[]): boolean {
  // Full border.
  for (let col = 0; col < MAZE_WIDTH; col++) {
    if (maze[0]?.charAt(col) !== WALL || maze[MAZE_HEIGHT - 1]?.charAt(col) !== WALL) {
      return false;
    }
  }
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    if (maze[row]?.charAt(0) !== WALL || maze[row]?.charAt(MAZE_WIDTH - 1) !== WALL) {
      return false;
    }
  }
  // Connectivity of all floor cells (BFS).
  const queue: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let row = 1; row < MAZE_HEIGHT - 1; row++) {
    for (let col = 1; col < MAZE_WIDTH - 1; col++) {
      if (isFloor(maze, col, row)) {
        queue.push([col, row]);
        seen.add(`${col},${row}`);
        break;
      }
    }
    if (queue.length > 0) {
      break;
    }
  }
  if (queue.length === 0) {
    return false;
  }
  let floorCount = 1;
  let edges = 0;
  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head]!;
    head++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = col + dx;
      const nr = row + dy;
      if (isFloor(maze, nc, nr)) {
        edges++;
        const key = `${nc},${nr}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push([nc, nr]);
          floorCount++;
        }
      }
    }
  }
  let totalFloors = 0;
  for (let row = 1; row < MAZE_HEIGHT - 1; row++) {
    for (let col = 1; col < MAZE_WIDTH - 1; col++) {
      if (isFloor(maze, col, row)) {
        totalFloors++;
      }
    }
  }
  if (floorCount !== totalFloors) {
    return false;
  }
  // No 2x2 open blocks.
  for (let row = 0; row < MAZE_HEIGHT - 1; row++) {
    for (let col = 0; col < MAZE_WIDTH - 1; col++) {
      if (
        isFloor(maze, col, row) &&
        isFloor(maze, col + 1, row) &&
        isFloor(maze, col, row + 1) &&
        isFloor(maze, col + 1, row + 1)
      ) {
        return false;
      }
    }
  }
  // Loop-rich: edges >= vertices (at least one cycle).
  return edges >= totalFloors;
}

/**
 * Generate a 21x19 maze for a seed. Deterministic; returns the static
 * `MAZE_MAP` fallback if the generated maze ever fails validation.
 */
export function generateMaze(seed: number): readonly string[] {
  const random = mulberry32(seed);
  const maze = blankMaze();

  // Horizontal corridor runs on every odd row.
  for (const row of ODD_ROWS) {
    for (let col = 1; col < MAZE_WIDTH - 1; col++) {
      setCell(maze, col, row, FLOOR);
    }
  }

  // Vertical connectors between consecutive odd rows. Decisions are mirrored
  // across the center column and center row for a symmetric, reference-like
  // feel. The outer perimeter columns are always open, forming an unbroken
  // ring that lets every row loop back on itself, so corridors offer turn
  // options rather than dead ends on either side. Higher connector probability
  // adds more internal loops.
  const bands = [0, 1, 2, 3]; // mirror pairs (0,7), (1,6), (2,5), (3,4)
  for (const band of bands) {
    const rowA = ODD_ROWS[band]! + 1; // even row between odd rows
    const rowB = ODD_ROWS[7 - band]! + 1;
    const openedA = new Set<number>(RING_CONNECTOR_COLS);
    const openedB = new Set<number>(RING_CONNECTOR_COLS);
    for (const [left, right] of CONNECTOR_PAIRS) {
      if (random() < CONNECTOR_PROBABILITY) {
        openedA.add(left);
        openedA.add(right);
        openedB.add(left);
        openedB.add(right);
      }
    }
    if (random() < CONNECTOR_PROBABILITY) {
      openedA.add(CENTER_COL);
      openedB.add(CENTER_COL);
    }
    for (const col of openedA) {
      setCell(maze, col, rowA, FLOOR);
    }
    for (const col of openedB) {
      setCell(maze, col, rowB, FLOOR);
    }
  }

  return validateMaze(maze) ? maze : MAZE_MAP;
}

/** First walkable cell scanning outward from the maze center (deterministic). */
export function findSpawnCell(maze: readonly string[]): { col: number; row: number } {
  const centerRow = Math.floor(MAZE_HEIGHT / 2);
  const centerCol = Math.floor(MAZE_WIDTH / 2);
  const maxRadius = Math.max(MAZE_WIDTH, MAZE_HEIGHT);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const col = centerCol + dx;
        const row = centerRow + dy;
        if (isFloor(maze, col, row)) {
          return { col, row };
        }
      }
    }
  }
  return { col: centerCol, row: centerRow };
}
