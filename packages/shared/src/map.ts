/**
 * The single shared maze for the T2 prototype: a symmetric 15x15 rectilinear
 * corridor maze (mirror-symmetric about both the center column and center
 * row). Border cells are walls; corridors are exactly one tile wide, with no
 * 2x2 open blocks and every corridor connected. Layout is original (no
 * Pac-Man assets or characters).
 *
 * Cell characters: '#' = wall, '.' = walkable floor.
 */
export const MAZE_WIDTH = 15;
export const MAZE_HEIGHT = 15;

export const MAZE_MAP: readonly string[] = [
  "###############",
  "#.............#",
  "#.###.#.#.###.#",
  "#.#.#.#.#.#.#.#",
  "#.#.#.....#.#.#",
  "#.....#.#.....#",
  "#.#.#.#.#.#.#.#",
  "#.....#.#.....#",
  "#.#.#.#.#.#.#.#",
  "#.....#.#.....#",
  "#.#.#.....#.#.#",
  "#.#.#.#.#.#.#.#",
  "#.###.#.#.###.#",
  "#.............#",
  "###############",
];

/** The walkable center cell of the maze. */
export const PLAYER_SPAWN: Readonly<{ col: number; row: number }> = {
  col: 7,
  row: 7,
};

export function isInside(col: number, row: number): boolean {
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    col < MAZE_WIDTH &&
    row >= 0 &&
    row < MAZE_HEIGHT
  );
}

export function isWalkable(col: number, row: number): boolean {
  if (!isInside(col, row)) {
    return false;
  }
  return MAZE_MAP[row]?.charAt(col) !== "#";
}
