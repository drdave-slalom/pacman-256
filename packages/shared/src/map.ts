/**
 * The single shared maze for the T2 prototype: a symmetric 21x19 rectilinear
 * corridor maze (mirror-symmetric about both the center column and center
 * row). Border cells are walls; corridors are exactly one tile wide, with no
 * 2x2 open blocks and every corridor connected. Layout is original (no
 * Pac-Man assets or characters), sized and shaped to echo the reference
 * maze.png pathing.
 *
 * Cell characters: '#' = wall, '.' = walkable floor.
 */
export const MAZE_WIDTH = 21;
export const MAZE_HEIGHT = 19;

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

/** Walkable check against an explicit maze grid (works for generated mazes). */
export function isWalkableIn(
  maze: readonly string[],
  col: number,
  row: number,
): boolean {
  if (!isInsideIn(MAZE_WIDTH, MAZE_HEIGHT, col, row)) {
    return false;
  }
  return maze[row]?.charAt(col) !== "#";
}
