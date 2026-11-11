import assert from "node:assert/strict";
import { test } from "node:test";
import { MAZE_HEIGHT, MAZE_MAP, MAZE_WIDTH, isWalkableIn, mazeDimensionsForPlayers } from "./map.ts";
import { generateMaze } from "./maze-gen.ts";
import { findSpawnCells, spawnDirection, SPAWN_MAX_PER_TEAM } from "./spawn.ts";
import { DEFAULT_MOVE_SPEED_TILES_PER_SECOND, stepPlayerMove, type PlayerMoveState } from "./movement.ts";

const SEEDS = [0, 1, 2, 7, 42, 1234, 99_999, 0xffffffff, ...Array.from({ length: 40 }, (_, i) => i * 7919 + 3)];

function distinctCount(cells: readonly { col: number; row: number }[]): number {
  return new Set(cells.map((cell) => `${cell.col},${cell.row}`)).size;
}

test("findSpawnCells returns distinct walkable cells in team quadrants for many seeds", () => {
  for (const seed of SEEDS) {
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze, { hunter: 3, runner: 3 });
    const all = [...spawns.hunter, ...spawns.runner];
    assert.equal(distinctCount(all), 6, `seed ${seed}: spawns must be distinct`);
    for (const cell of all) {
      assert.ok(isWalkableIn(maze, cell.col, cell.row), `seed ${seed}: ${JSON.stringify(cell)} walkable`);
    }
    const midRow = Math.floor(MAZE_HEIGHT / 2);
    const midCol = Math.floor(MAZE_WIDTH / 2);
    for (const cell of spawns.hunter) assert.ok(cell.row < midRow, `seed ${seed}: hunters top`);
    for (const cell of spawns.runner) assert.ok(cell.row > midRow, `seed ${seed}: runners bottom`);
    assert.ok(spawns.hunter[0]!.col < midCol && spawns.hunter[1]!.col > midCol);
    assert.ok(spawns.runner[0]!.col < midCol && spawns.runner[1]!.col > midCol);
  }
});

test("findSpawnCells yields three distinct walkable cells per team on request", () => {
  for (const seed of SEEDS) {
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze, { hunter: 3, runner: 3 });
    for (const side of ["hunter", "runner"] as const) {
      const team = spawns[side];
      assert.equal(team.length, 3, `seed ${seed}: ${side} has 3 spawns`);
      assert.equal(distinctCount(team), 3, `seed ${seed}: ${side} spawns must be distinct`);
      for (const cell of team) {
        assert.ok(isWalkableIn(maze, cell.col, cell.row), `seed ${seed}: ${side} ${JSON.stringify(cell)} walkable`);
      }
    }
  }
});

test("T12: default spawn placement provides SPAWN_MAX_PER_TEAM distinct cells per team", () => {
  assert.equal(SPAWN_MAX_PER_TEAM, 16);
  for (const seed of SEEDS) {
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze);
    for (const side of ["hunter", "runner"] as const) {
      const team = spawns[side];
      assert.equal(team.length, SPAWN_MAX_PER_TEAM, `seed ${seed}: ${side} has 16 spawns`);
      assert.equal(distinctCount(team), SPAWN_MAX_PER_TEAM, `seed ${seed}: ${side} spawns must be distinct`);
      for (const cell of team) {
        assert.ok(isWalkableIn(maze, cell.col, cell.row), `seed ${seed}: ${side} ${JSON.stringify(cell)} walkable`);
      }
    }
  }
});

test("findSpawnCells is deterministic per maze and works on the static map", () => {
  const maze = generateMaze(42);
  assert.deepEqual(findSpawnCells(maze), findSpawnCells(generateMaze(42)));
  const fallback = findSpawnCells(MAZE_MAP, { hunter: 3, runner: 3 });
  assert.equal(distinctCount([...fallback.hunter, ...fallback.runner]), 6);
  const full = findSpawnCells(MAZE_MAP);
  assert.equal(full.hunter.length, SPAWN_MAX_PER_TEAM);
  assert.equal(distinctCount([...full.hunter, ...full.runner]), 2 * SPAWN_MAX_PER_TEAM);
});

test("spawn inset is tunable", () => {
  const maze = generateMaze(5);
  const outer = findSpawnCells(maze, 1);
  const inner = findSpawnCells(maze, 5);
  assert.ok(outer.runner[0]!.row - outer.hunter[0]!.row >= inner.runner[0]!.row - inner.hunter[0]!.row);
});

test("T12: scaled mazes support 16 spawns per team, split top/bottom, distinct and walkable", () => {
  for (const players of [16, 32]) {
    const dims = mazeDimensionsForPlayers(players);
    for (let seed = 0; seed < 30; seed++) {
      const maze = generateMaze(seed, dims);
      const spawns = findSpawnCells(maze);
      assert.equal(spawns.hunter.length, SPAWN_MAX_PER_TEAM);
      assert.equal(spawns.runner.length, SPAWN_MAX_PER_TEAM);
      assert.equal(distinctCount([...spawns.hunter, ...spawns.runner]), 32);
      const midRow = Math.floor(dims.height / 2);
      for (const cell of spawns.hunter) {
        assert.ok(cell.row < midRow, `seed ${seed}: hunter top on ${dims.width}x${dims.height}`);
        assert.ok(isWalkableIn(maze, cell.col, cell.row));
      }
      for (const cell of spawns.runner) {
        assert.ok(cell.row > midRow, `seed ${seed}: runner bottom on ${dims.width}x${dims.height}`);
        assert.ok(isWalkableIn(maze, cell.col, cell.row));
      }
      for (const cell of [...spawns.hunter, ...spawns.runner]) {
        spawnDirection(maze, cell);
      }
    }
  }
});

test("T12: uneven teams up to capacity get as many distinct spawns as requested", () => {
  const cases: Array<{ players: number; hunter: number; runner: number }> = [
    { players: 32, hunter: 31, runner: 1 },
    { players: 32, hunter: 17, runner: 15 },
    { players: 16, hunter: 1, runner: 15 },
    { players: 9, hunter: 1, runner: 8 },
  ];
  for (const { players, hunter, runner } of cases) {
    const dims = mazeDimensionsForPlayers(players);
    const maze = generateMaze(7, dims);
    const spawns = findSpawnCells(maze, { hunter, runner });
    assert.equal(spawns.hunter.length, hunter, `${hunter}v${runner}`);
    assert.equal(spawns.runner.length, runner, `${hunter}v${runner}`);
    assert.equal(distinctCount([...spawns.hunter, ...spawns.runner]), hunter + runner);
    const midRow = Math.floor(dims.height / 2);
    for (const cell of spawns.hunter) assert.ok(cell.row < midRow);
    for (const cell of spawns.runner) assert.ok(cell.row > midRow);
  }
});

const MANY_SEEDS = Array.from({ length: 500 }, (_, i) => (i * 2_654_435_761) >>> 0);

test("players never move from spawn before their first input (500 seeds + static map)", () => {
  for (const seed of [...MANY_SEEDS, null]) {
    const maze = seed === null ? MAZE_MAP : generateMaze(seed);
    const spawns = findSpawnCells(maze, { hunter: 3, runner: 3 });
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
