import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMinimalValidMaze, findSpawnCell, generateMaze } from "./maze-gen.ts";
import { MAZE_HEIGHT, MAZE_WIDTH, isWalkableIn, mazeDimensionsForPlayers } from "./map.ts";

function isFloor(maze: readonly string[], col: number, row: number): boolean {
  return isWalkableIn(maze, col, row) && maze[row]?.charAt(col) === ".";
}

function validateGenerated(maze: readonly string[], width = MAZE_WIDTH, height = MAZE_HEIGHT): void {
  assert.equal(maze.length, height);
  for (const row of maze) {
    assert.equal(row.length, width);
  }
  // Border walls.
  for (let col = 0; col < width; col++) {
    assert.equal(maze[0]?.charAt(col), "#");
    assert.equal(maze[height - 1]?.charAt(col), "#");
  }
  for (let row = 0; row < height; row++) {
    assert.equal(maze[row]?.charAt(0), "#");
    assert.equal(maze[row]?.charAt(width - 1), "#");
  }
  // No 2x2 open blocks.
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      assert.ok(
        !(
          isFloor(maze, col, row) &&
          isFloor(maze, col + 1, row) &&
          isFloor(maze, col, row + 1) &&
          isFloor(maze, col + 1, row + 1)
        ),
        `2x2 open block at ${col},${row}`,
      );
    }
  }
  // Connectivity from spawn.
  const spawn = findSpawnCell(maze);
  assert.ok(isFloor(maze, spawn.col, spawn.row));
  const seen = new Set<string>([`${spawn.col},${spawn.row}`]);
  const queue: Array<[number, number]> = [[spawn.col, spawn.row]];
  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head]!;
    head++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${col + dx},${row + dy}`;
      if (isFloor(maze, col + dx, row + dy) && !seen.has(key)) {
        seen.add(key);
        queue.push([col + dx, row + dy]);
      }
    }
  }
  let floorCount = 0;
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      if (isFloor(maze, col, row)) {
        floorCount++;
      }
    }
  }
  assert.equal(seen.size, floorCount, "all floors must be reachable from spawn");
  // Loop-rich: edges >= vertices in the floor graph.
  let edges = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (isFloor(maze, col, row)) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          if (isFloor(maze, col + dx, row + dy)) {
            edges++;
          }
        }
      }
    }
  }
  assert.ok(edges >= floorCount, "generated maze should contain loops");
}

test("generation is deterministic per seed", () => {
  for (const seed of [0, 1, 42, 123456789, 2 ** 31 - 1]) {
    assert.deepEqual(generateMaze(seed), generateMaze(seed));
  }
});

test("generated mazes satisfy structure invariants across many seeds", () => {
  for (let seed = 0; seed < 60; seed++) {
    validateGenerated(generateMaze(seed));
  }
});

test("generated mazes have floor variety across seeds", () => {
  const layouts = new Set<string>();
  for (let seed = 0; seed < 40; seed++) {
    layouts.add(generateMaze(seed).join("\n"));
  }
  assert.ok(layouts.size >= 2, "expected more than one distinct generated maze");
});

test("spawn cell is inside the maze and walkable", () => {
  for (let seed = 0; seed < 20; seed++) {
    const maze = generateMaze(seed);
    const spawn = findSpawnCell(maze);
    assert.ok(spawn.col >= 0 && spawn.col < MAZE_WIDTH);
    assert.ok(spawn.row >= 0 && spawn.row < MAZE_HEIGHT);
    assert.ok(isFloor(maze, spawn.col, spawn.row));
  }
});

test("T12: the 21x19 path is unchanged byte-for-byte when scaled dimensions equal the base", () => {
  for (let seed = 0; seed < 80; seed++) {
    assert.deepEqual(
      generateMaze(seed, { width: 21, height: 19 }),
      generateMaze(seed),
      `seed ${seed}: explicit 21x19 must equal the default path`,
    );
  }
});

test("T12: small rooms (<= 8 players) request the exact base canvas", () => {
  for (let players = 1; players <= 8; players++) {
    const dims = mazeDimensionsForPlayers(players);
    assert.deepEqual(dims, { width: MAZE_WIDTH, height: MAZE_HEIGHT });
    for (let seed = 0; seed < 20; seed++) {
      assert.deepEqual(generateMaze(seed, dims), generateMaze(seed));
    }
  }
});

const LARGE_DIMS = [9, 16, 17, 24, 25, 32].map(mazeDimensionsForPlayers);

test("T12: scaled mazes preserve every invariant across sizes and seeds", () => {
  for (const dims of LARGE_DIMS) {
    for (let seed = 0; seed < 40; seed++) {
      const maze = generateMaze(seed, dims);
      validateGenerated(maze, dims.width, dims.height);
      assert.deepEqual(generateMaze(seed, dims), generateMaze(seed, dims), `seed ${seed} deterministic`);
    }
  }
});

test("T12: scaled mazes are distinct per seed (not a static fallback)", () => {
  for (const dims of LARGE_DIMS) {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      layouts.add(generateMaze(seed, dims).join("\n"));
    }
    assert.ok(layouts.size >= 2, `${dims.width}x${dims.height} should vary by seed`);
  }
});

test("T12: scaled mazes are mirror-symmetric about the center row and column", () => {
  for (const dims of LARGE_DIMS) {
    for (let seed = 0; seed < 25; seed++) {
      const maze = generateMaze(seed, dims);
      for (let row = 0; row < dims.height; row++) {
        for (let col = 0; col < dims.width; col++) {
          assert.equal(
            maze[row]![col],
            maze[row]![dims.width - 1 - col],
            `seed ${seed}: ${dims.width}x${dims.height} not h-symmetric at ${col},${row}`,
          );
          assert.equal(
            maze[row]![col],
            maze[dims.height - 1 - row]![col],
            `seed ${seed}: ${dims.width}x${dims.height} not v-symmetric at ${col},${row}`,
          );
        }
      }
    }
  }
});

test("T12: buildMinimalValidMaze is a valid, symmetric fallback for every scaled size", () => {
  for (const dims of LARGE_DIMS) {
    const maze = buildMinimalValidMaze(dims.width, dims.height);
    validateGenerated(maze, dims.width, dims.height);
    for (let row = 0; row < dims.height; row++) {
      for (let col = 0; col < dims.width; col++) {
        assert.equal(maze[row]![col], maze[row]![dims.width - 1 - col]);
        assert.equal(maze[row]![col], maze[dims.height - 1 - row]![col]);
      }
    }
  }
});
