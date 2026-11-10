import assert from "node:assert/strict";
import { test } from "node:test";
import { MAZE_HEIGHT, MAZE_MAP, MAZE_WIDTH, isWalkableIn } from "./map.ts";
import { generateMaze } from "./maze-gen.ts";
import { findSpawnCells, spawnDirection } from "./spawn.ts";
import { DEFAULT_MOVE_SPEED_TILES_PER_SECOND, stepPlayerMove, type PlayerMoveState } from "./movement.ts";

const SEEDS = [0, 1, 2, 7, 42, 1234, 99_999, 0xffffffff, ...Array.from({ length: 40 }, (_, i) => i * 7919 + 3)];

test("findSpawnCells returns distinct walkable cells in team quadrants for many seeds", () => {
  for (const seed of SEEDS) {
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze);
    const all = [...spawns.hunter, ...spawns.runner];
    const keys = new Set(all.map((cell) => `${cell.col},${cell.row}`));
    assert.equal(keys.size, 6, `seed ${seed}: spawns must be distinct`);
    for (const cell of all) {
      assert.ok(isWalkableIn(maze, cell.col, cell.row), `seed ${seed}: ${JSON.stringify(cell)} walkable`);
    }
    const midRow = Math.floor(MAZE_HEIGHT / 2);
    const midCol = Math.floor(MAZE_WIDTH / 2);
    for (const cell of spawns.hunter) assert.ok(cell.row < midRow, `seed ${seed}: hunters top`);
    for (const cell of spawns.runner) assert.ok(cell.row > midRow, `seed ${seed}: runners bottom`);
    assert.ok(spawns.hunter[0].col < midCol && spawns.hunter[1].col > midCol);
    assert.ok(spawns.runner[0].col < midCol && spawns.runner[1].col > midCol);
  }
});

test("findSpawnCells yields three distinct walkable cells per team", () => {
  for (const seed of SEEDS) {
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze);
    for (const side of ["hunter", "runner"] as const) {
      const team = spawns[side];
      assert.equal(team.length, 3, `seed ${seed}: ${side} has 3 spawns`);
      const keys = new Set(team.map((cell) => `${cell.col},${cell.row}`));
      assert.equal(keys.size, 3, `seed ${seed}: ${side} spawns must be distinct`);
      for (const cell of team) {
        assert.ok(isWalkableIn(maze, cell.col, cell.row), `seed ${seed}: ${side} ${JSON.stringify(cell)} walkable`);
      }
    }
  }
});

test("findSpawnCells is deterministic per maze and works on the static map", () => {
  const maze = generateMaze(42);
  assert.deepEqual(findSpawnCells(maze), findSpawnCells(generateMaze(42)));
  const fallback = findSpawnCells(MAZE_MAP);
  assert.equal(new Set([...fallback.hunter, ...fallback.runner].map((c) => `${c.col},${c.row}`)).size, 6);
});

test("spawn inset is tunable", () => {
  const maze = generateMaze(5);
  const outer = findSpawnCells(maze, 1);
  const inner = findSpawnCells(maze, 5);
  assert.ok(outer.runner[0].row - outer.hunter[0].row >= inner.runner[0].row - inner.hunter[0].row);
});

const MANY_SEEDS = Array.from({ length: 500 }, (_, i) => (i * 2_654_435_761) >>> 0);

test("players never move from spawn before their first input (500 seeds + static map)", () => {
  for (const seed of [...MANY_SEEDS, null]) {
    const maze = seed === null ? MAZE_MAP : generateMaze(seed);
    const spawns = findSpawnCells(maze);
    for (const cell of [...spawns.hunter, ...spawns.runner]) {
      const start: PlayerMoveState = {
        position: { x: cell.col + 0.5, y: cell.row + 0.5 },
        direction: spawnDirection(maze, cell),
        queuedDirection: null,
      };
      let state = start;
      for (let tick = 0; tick < 30; tick++) {
        state = stepPlayerMove(state, DEFAULT_MOVE_SPEED_TILES_PER_SECOND, 1 / 30, maze);
      }
      assert.deepEqual(state.position, start.position, `seed ${seed}: ${JSON.stringify(cell)} stationary`);
    }
  }
});
