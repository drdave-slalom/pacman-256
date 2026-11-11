import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAZE_HEIGHT,
  MAZE_MAP,
  MAZE_WIDTH,
  PLAYER_SPAWN,
  isInside,
  isWalkable,
  isWalkableIn,
  mazeDimensionsForPlayers,
} from "./map.ts";

test("maze grid has the approved dimensions", () => {
  assert.equal(MAZE_WIDTH, 21);
  assert.equal(MAZE_HEIGHT, 19);
  assert.equal(MAZE_MAP.length, MAZE_HEIGHT);
  for (const row of MAZE_MAP) {
    assert.equal(row.length, MAZE_WIDTH);
  }
});

test("map helpers accept only integer cells inside the grid", () => {
  assert.equal(isInside(0, 0), true);
  assert.equal(isInside(20, 18), true);
  assert.equal(isInside(-1, 0), false);
  assert.equal(isInside(21, 0), false);
  assert.equal(isInside(0, -1), false);
  assert.equal(isInside(0, 19), false);
  assert.equal(isInside(1.5, 1), false);
  assert.equal(isInside(1, 1.5), false);
});

test("border walls and interior corridors are encoded consistently", () => {
  for (let col = 0; col < MAZE_WIDTH; col++) {
    assert.equal(isWalkable(col, 0), false);
    assert.equal(isWalkable(col, MAZE_HEIGHT - 1), false);
  }
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    assert.equal(isWalkable(0, row), false);
    assert.equal(isWalkable(MAZE_WIDTH - 1, row), false);
  }
  assert.equal(isWalkable(1, 1), true);
  assert.equal(isWalkable(13, 9), true);
  assert.equal(isWalkable(2, 2), false);
  assert.equal(isWalkable(-1, 5), false);
  assert.equal(isWalkable(5, 19), false);
});

test("spawn cell is inside the maze and walkable", () => {
  assert.equal(isInside(PLAYER_SPAWN.col, PLAYER_SPAWN.row), true);
  assert.equal(isWalkable(PLAYER_SPAWN.col, PLAYER_SPAWN.row), true);
});

test("mazeDimensionsForPlayers keeps the 21x19 canvas up to 8 players and scales above", () => {
  for (let players = 1; players <= 8; players++) {
    assert.deepEqual(mazeDimensionsForPlayers(players), { width: 21, height: 19 });
  }
  for (let players = 9; players <= 16; players++) {
    assert.deepEqual(mazeDimensionsForPlayers(players), { width: 25, height: 23 });
  }
  for (let players = 17; players <= 24; players++) {
    assert.deepEqual(mazeDimensionsForPlayers(players), { width: 29, height: 27 });
  }
  for (let players = 25; players <= 32; players++) {
    assert.deepEqual(mazeDimensionsForPlayers(players), { width: 33, height: 31 });
  }
});

test("isWalkableIn uses the maze's own dimensions, not just the static canvas", () => {
  const small = MAZE_MAP;
  assert.equal(isWalkableIn(small, 19, 17), true);
  assert.equal(isWalkableIn(small, 21, 18), false, "outside the 21x19 grid");
  const large = Array.from({ length: 31 }, (_, row) =>
    row === 0 || row === 30 ? "#".repeat(33) : `#${".".repeat(31)}#`,
  );
  assert.equal(isWalkableIn(large, 31, 29), true, "large maze interior");
  assert.equal(isWalkableIn(large, 32, 29), false, "large maze border");
  assert.equal(isWalkableIn(large, 1, 30), false, "large maze bottom border");
});

test("every walkable cell is reachable from the spawn", () => {
  const visited = new Set<string>();
  const queue: Array<[number, number]> = [[PLAYER_SPAWN.col, PLAYER_SPAWN.row]];
  visited.add(`${PLAYER_SPAWN.col},${PLAYER_SPAWN.row}`);
  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head]!;
    head++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextKey = `${col + dx},${row + dy}`;
      if (isWalkable(col + dx, row + dy) && !visited.has(nextKey)) {
        visited.add(nextKey);
        queue.push([col + dx, row + dy]);
      }
    }
  }
  for (let row = 0; row < MAZE_HEIGHT; row++) {
    for (let col = 0; col < MAZE_WIDTH; col++) {
      if (isWalkable(col, row)) {
        assert.ok(visited.has(`${col},${row}`), `cell ${col},${row} must be reachable`);
      }
    }
  }
});
