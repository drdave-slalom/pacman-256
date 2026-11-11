/**
 * The single shared maze for the T2 prototype: a symmetric 21x19 rectilinear
 * corridor maze (mirror-symmetric about both the center column and center
 * row). Border cells are walls; corridors are exactly one tile wide, with no
 * 2x2 open blocks and every corridor connected. Layout is original (no
 * Pac-Man assets or characters), sized and shaped to echo the reference
 * maze.png pathing.
 *
 * Cell characters: '#' = wall, '.' = walkable floor.
 *
 * T12: rooms larger than the MVP cap generate scaled mazes whose dimensions
 * come from `mazeDimensionsForPlayers` (the single source of truth for the
 * sizing rule, shared by server and client so both regenerate identical maps
 * from the same seed). Rooms up to 8 players keep the exact 21x19 canvas.
 */
export const MAZE_WIDTH = 21;
export const MAZE_HEIGHT = 19;

export interface MazeDimensions {
  width: number;
  height: number;
}

/**
 * Maze dimensions for a room of `totalPlayers` connected players (T12).
 *
 * Rooms up to 8 players keep the original 21x19 canvas byte-for-byte. Larger
 * rooms scale up in 4-tile steps per 8 extra players, staying odd-sized so
 * the generator's mirror symmetry about the center row/column is preserved.
 * This rule is deterministic and part of shared config: the server and every
 * client derive identical dimensions from the same roster size at round start.
 */
export function mazeDimensionsForPlayers(totalPlayers: number): MazeDimensions {
  if (totalPlayers <= 8) {
    return { width: MAZE_WIDTH, height: MAZE_HEIGHT };
  }
  const extra = Math.ceil((totalPlayers - 8) / 8);
  return {
    width: MAZE_WIDTH + extra * 4,
    height: MAZE_HEIGHT + extra * 4,
  };
}

export const MAZE_MAP: readonly string[] = [
  "#####################",
  "#...................#",
  "#.###.#.#.#.#.#.###.#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.....#.#.#.#.#.....#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.....#.#.#.#.#.....#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.....#.#.#.#.#.....#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.....#.#.#.#.#.....#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.#.#.#.#.#.#.#.#.#.#",
  "#.###.#.#.#.#.#.###.#",
  "#...................#",
  "#####################",
];

/** A walkable cell just left of the maze center. */
export const PLAYER_SPAWN: Readonly<{ col: number; row: number }> = {
  col: 9,
  row: 9,
};

export function isInside(col: number, row: number): boolean {
  return isInsideIn(MAZE_WIDTH, MAZE_HEIGHT, col, row);
}

export function isWalkable(col: number, row: number): boolean {
  return isWalkableIn(MAZE_MAP, col, row);
}

/** Grid-bounds check against explicit dimensions (works for generated mazes). */
export function isInsideIn(
  width: number,
  height: number,
  col: number,
  row: number,
): boolean {
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    col < width &&
    row >= 0 &&
    row < height
  );
}

/**
 * Walkable check against an explicit maze grid. Bounds come from the maze
 * itself (not the static 21x19 constants) so generated mazes of any size
 * validate correctly. For `MAZE_MAP` the behavior is identical to before.
 */
export function isWalkableIn(
  maze: readonly string[],
  col: number,
  row: number,
): boolean {
  const height = maze.length;
  const width = height > 0 ? maze[0]!.length : 0;
  if (!isInsideIn(width, height, col, row)) {
    return false;
  }
  return maze[row]?.charAt(col) !== "#";
}
