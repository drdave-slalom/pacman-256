/**
 * The single shared maze for the T2 prototype: a compact 15x11 rectilinear
 * corridor maze. Border cells are walls; corridors are exactly one tile wide.
 * Layout is original (no Pac-Man assets or characters).
 *
 * Cell characters: '#' = wall, '.' = walkable floor.
 */
export const MAZE_WIDTH = 15;
export const MAZE_HEIGHT = 11;

export const MAZE_MAP: readonly string[] = [
  "###############",
  "#.............#",
  "#.###...###...#",
  "#.#...#.#...#.#",
  "#.#.#.#.#.#.#.#",
  "#...#...#.....#",
  "#.#.#.#.#.#.#.#",
  "#.#...#.#...#.#",
  "#.###...###...#",
  "#.............#",
  "###############",
];

/** A walkable spawn cell near the maze center. */
export const PLAYER_SPAWN: Readonly<{ col: number; row: number }> = {
  col: 7,
  row: 5,
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
