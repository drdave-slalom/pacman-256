import assert from "node:assert/strict";
import { test } from "node:test";
import { findSpawnCell, generateMaze } from "./maze-gen.ts";
import { MAZE_HEIGHT, MAZE_WIDTH, isWalkableIn } from "./map.ts";

function isFloor(maze: readonly string[], col: number, row: number): boolean {
  return isWalkableIn(maze, col, row) && maze[row]?.charAt(col) === ".";
}

function validateGenerated(maze: readonly string[]): void {
  assert.equal(maze.length, MAZE_HEIGHT);
  for (const row of maze) {
    assert.equal(row.length, MAZE_WIDTH);
  }
  // Border walls.
  for (let col = 0; col < MAZE_WIDTH; col++) {
    assert.equal(maze[0]?.charAt(col), "#");
    assert.equal(maze[MAZE_HEIGHT - 1]?.charAt(col), "#");
  }
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    assert.equal(maze[row]?.charAt(0), "#");
    assert.equal(maze[row]?.charAt(MAZE_WIDTH - 1), "#");
  }
  // No 2x2 open blocks.
  for (let row = 0; row < MAZE_HEIGHT - 1; row++) {
    for (let col = 0; col < MAZE_WIDTH - 1; col++) {
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
  for (let row = 1; row < MAZE_HEIGHT - 1; row++) {
    for (let col = 1; col < MAZE_WIDTH - 1; col++) {
      if (isFloor(maze, col, row)) {
        floorCount++;
      }
    }
  }
  assert.equal(seen.size, floorCount, "all floors must be reachable from spawn");
  // Loop-rich: edges >= vertices in the floor graph.
  let edges = 0;
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    for (let col = 0; col < MAZE_WIDTH; col++) {
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
