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
