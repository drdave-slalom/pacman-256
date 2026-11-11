import {
  MAZE_HEIGHT,
  MAZE_MAP,
  MAZE_WIDTH,
  isWalkableIn,
  type MazeDimensions,
} from "./map.ts";

/**
 * Seeded, deterministic maze generation for the T2 prototype.
 *
 * Generates dense, loop-rich, reference-style corridor mazes on an odd-sized
 * canvas: full border walls, one-tile corridors, horizontal runs on every odd
 * row, and vertical connectors on even columns (mirrored across both the
 * center column and center row). The same seed always produces the same maze,
 * so the authoritative server (T3+) can regenerate the identical map from a
 * shared seed. `MAZE_MAP` remains the static default/fallback.
 *
 * T12: dimensions default to the fixed 21x19 canvas and stay byte-for-byte
 * identical for rooms up to 8 players. Larger rooms pass dimensions from
 * `mazeDimensionsForPlayers` (shared config), so server and client agree on
 * the regenerated map without any new protocol field.
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

const CONNECTOR_PROBABILITY = 0.6;

function blankMaze(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let row = 0; row < height; row++) {
    rows.push(WALL.repeat(width));
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

function mazeDims(maze: readonly string[]): { width: number; height: number } {
  const height = maze.length;
  return { width: height > 0 ? maze[0]!.length : 0, height };
}

function validateMaze(maze: readonly string[]): boolean {
  const { width, height } = mazeDims(maze);
  // Full border.
  for (let col = 0; col < width; col++) {
    if (maze[0]?.charAt(col) !== WALL || maze[height - 1]?.charAt(col) !== WALL) {
      return false;
    }
  }
  for (let row = 0; row < height; row++) {
    if (maze[row]?.charAt(0) !== WALL || maze[row]?.charAt(width - 1) !== WALL) {
      return false;
    }
  }
  // Connectivity of all floor cells (BFS).
  const queue: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
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
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      if (isFloor(maze, col, row)) {
        totalFloors++;
      }
    }
  }
  if (floorCount !== totalFloors) {
    return false;
  }
  // No 2x2 open blocks.
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
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

/** Collect maximal '#' runs on even interior rows (candidate wall bars). */
function collectBars(maze: string[]): Array<{ row: number; from: number; to: number }> {
  const { width, height } = mazeDims(maze);
  const bars: Array<{ row: number; from: number; to: number }> = [];
  for (let row = 2; row < height - 1; row += 2) {
    let run = -1;
    for (let col = 1; col < width - 1; col++) {
      if (maze[row]?.charAt(col) === WALL) {
        if (run < 0) {
          run = col;
        }
      } else if (run >= 0) {
        if (col - run >= 2) {
          bars.push({ row, from: run, to: col - 1 });
        }
        run = -1;
      }
    }
    if (run >= 0 && width - 1 - run >= 2) {
      bars.push({ row, from: run, to: width - 2 });
    }
  }
  return bars;
}

/** Candidate tetromino-style leg positions for a wall bar (L/J/T feet). */
function legCandidates(
  bar: { row: number; from: number; to: number },
  maze: string[],
): Array<{ col: number; row: number }> {
  const { height } = mazeDims(maze);
  const cols = new Set<number>([bar.from, bar.to, Math.floor((bar.from + bar.to) / 2)]);
  const out: Array<{ col: number; row: number }> = [];
  for (const col of cols) {
    for (const dy of [-1, 1]) {
      const row = bar.row + dy;
      if (row > 0 && row < height - 1 && maze[row]?.charAt(col) === FLOOR) {
        out.push({ col, row });
      }
    }
  }
  return out;
}

function cloneMaze(maze: string[]): string[] {
  return [...maze];
}

/**
 * Decorate wall bars with tetromino-style extensions. Each candidate leg is
 * applied only when the resulting maze still validates (connected, bordered,
 * no 2x2 open blocks), so corridors keep working.
 */
function decorateWithTetrominoes(maze: string[], random: () => number): string[] {
  const bars = collectBars(maze);
  if (bars.length === 0) {
    return maze;
  }
  for (const bar of bars) {
    if (random() > 0.45) {
      continue;
    }
    const legs = legCandidates(bar, maze);
    if (legs.length === 0) {
      continue;
    }
    const leg = legs[Math.floor(random() * legs.length)]!;
    const trial = cloneMaze(maze);
    setCell(trial, leg.col, leg.row, WALL);
    if (validateMaze(trial)) {
      maze = trial;
    }
  }
  return maze;
}

/**
 * Minimal structurally-guaranteed valid maze for a canvas: corridors on every
 * odd row plus the two outer ring columns opened on every even row. By
 * construction this is always bordered, connected, symmetric, loop-rich, and
 * free of 2x2 open blocks. Used as the documented fallback when a scaled
 * maze's generated base ever fails validation (unreachable in practice), so
 * a scaled canvas can never leak an unvalidated grid. Exported for direct
 * invariant coverage.
 */
export function buildMinimalValidMaze(width: number, height: number): string[] {
  const maze = blankMaze(width, height);
  for (let row = 1; row < height - 1; row += 2) {
    for (let col = 1; col < width - 1; col++) {
      setCell(maze, col, row, FLOOR);
    }
  }
  for (let row = 2; row < height - 1; row += 2) {
    setCell(maze, 1, row, FLOOR);
    setCell(maze, width - 2, row, FLOOR);
  }
  return maze;
}

/** Canonical key for a wall bar. */
function barKey(bar: { row: number; from: number; to: number }): string {
  return `${bar.row}:${bar.from}:${bar.to}`;
}

/** Mirror a wall bar across the center column. */
function reflectCol(
  bar: { row: number; from: number; to: number },
  width: number,
): { row: number; from: number; to: number } {
  return { row: bar.row, from: width - 1 - bar.to, to: width - 1 - bar.from };
}

/** Mirror a wall bar across the center row. */
function reflectRow(
  bar: { row: number; from: number; to: number },
  height: number,
): { row: number; from: number; to: number } {
  return { row: height - 1 - bar.row, from: bar.from, to: bar.to };
}

/**
 * Decorate wall bars in dihedral orbits so a scaled maze keeps the generator's
 * full mirror symmetry about the center row AND center column. One random roll
 * decides an entire orbit (up to four mirror-sibling bars): a leg is chosen on
 * the seed bar and the complete orbit of that leg (its horizontal, vertical,
 * and combined mirrors) is placed together, then validated as one trial. A
 * rejected trial applies nothing, so corridors keep working and the final wall
 * set is a union of full orbits, hence symmetric.
 */
function decorateSymmetrically(maze: string[], random: () => number): string[] {
  const { width, height } = mazeDims(maze);
  const bars = collectBars(maze);
  const processed = new Set<string>();
  for (const bar of bars) {
    const orbitIds = [
      barKey(bar),
      barKey(reflectCol(bar, width)),
      barKey(reflectRow(bar, height)),
      barKey(reflectCol(reflectRow(bar, height), width)),
    ];
    if (processed.has(orbitIds[0]!)) {
      continue;
    }
    for (const id of orbitIds) {
      processed.add(id);
    }
    if (random() > 0.45) {
      continue;
    }
    const legs = legCandidates(bar, maze);
    if (legs.length === 0) {
      continue;
    }
    const leg = legs[Math.floor(random() * legs.length)]!;
    const trial = cloneMaze(maze);
    setCell(trial, leg.col, leg.row, WALL);
    setCell(trial, width - 1 - leg.col, leg.row, WALL);
    setCell(trial, leg.col, height - 1 - leg.row, WALL);
    setCell(trial, width - 1 - leg.col, height - 1 - leg.row, WALL);
    if (validateMaze(trial)) {
      maze = trial;
    }
  }
  return maze;
}

/**
 * Generate a maze for a seed. Deterministic. For the base 21x19 canvas the
 * output is byte-for-byte stable and returns the static `MAZE_MAP` fallback
 * only if base generation ever fails validation. Scaled canvases never return
 * an unvalidated grid: if the base fails validation they fall back to
 * `buildMinimalValidMaze`, and if even that cannot validate (unreachable by
 * construction) generation fails loudly with an error.
 */
export function generateMaze(
  seed: number,
  dimensions: MazeDimensions = { width: MAZE_WIDTH, height: MAZE_HEIGHT },
): readonly string[] {
  const { width, height } = dimensions;
  const random = mulberry32(seed);
  const maze = blankMaze(width, height);

  // Horizontal corridor runs on every odd row.
  for (let row = 1; row < height - 1; row += 2) {
    for (let col = 1; col < width - 1; col++) {
      setCell(maze, col, row, FLOOR);
    }
  }

  // Vertical connectors between consecutive odd rows. Decisions are mirrored
  // across the center column and center row for a symmetric, reference-like
  // feel. The outer perimeter columns are always open, forming an unbroken
  // ring that lets every row loop back on itself, so corridors offer turn
  // options rather than dead ends on either side. Higher connector probability
  // adds more internal loops.
  const oddRows: number[] = [];
  for (let row = 1; row < height - 1; row += 2) {
    oddRows.push(row);
  }
  const centerCol = Math.floor(width / 2);
  const ringCols = [1, width - 2];
  const pairCols: Array<[number, number]> = [];
  for (let left = 4; left < centerCol - 1; left += 2) {
    pairCols.push([left, width - 1 - left]);
  }
  const bandCount = Math.floor(oddRows.length / 2);
  for (let band = 0; band < bandCount; band++) {
    const rowA = oddRows[band]! + 1; // even row between odd rows
    const rowB = oddRows[oddRows.length - 2 - band]! + 1;
    const openedA = new Set<number>(ringCols);
    const openedB = new Set<number>(ringCols);
    for (const [left, right] of pairCols) {
      if (random() < CONNECTOR_PROBABILITY) {
        openedA.add(left);
        openedA.add(right);
        openedB.add(left);
        openedB.add(right);
      }
    }
    if (random() < CONNECTOR_PROBABILITY) {
      openedA.add(centerCol);
      openedB.add(centerCol);
    }
    for (const col of openedA) {
      setCell(maze, col, rowA, FLOOR);
    }
    for (const col of openedB) {
      setCell(maze, col, rowB, FLOOR);
    }
  }

  if (!validateMaze(maze)) {
    if (width === MAZE_WIDTH && height === MAZE_HEIGHT) {
      return MAZE_MAP;
    }
    const fallback = buildMinimalValidMaze(width, height);
    if (!validateMaze(fallback)) {
      throw new Error(`Cannot generate a valid ${width}x${height} maze for seed ${seed}.`);
    }
    return fallback;
  }
  const isBaseSize = width === MAZE_WIDTH && height === MAZE_HEIGHT;
  const decorated = isBaseSize
    ? decorateWithTetrominoes(maze, random)
    : decorateSymmetrically(maze, random);
  return validateMaze(decorated) ? decorated : maze;
}

/** First walkable cell scanning outward from the maze center (deterministic). */
export function findSpawnCell(maze: readonly string[]): { col: number; row: number } {
  const centerRow = Math.floor(maze.length / 2);
  const centerCol = Math.floor((maze[0]?.length ?? 0) / 2);
  const maxRadius = Math.max(maze[0]?.length ?? 0, maze.length);
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
