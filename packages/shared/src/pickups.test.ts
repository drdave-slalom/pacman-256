import assert from "node:assert/strict";
import { test } from "node:test";
import { contactOutcome, effectActive, pickupArrival, pickupCell, pickupClaim, pickupRandom, pickupTiming, seededPriority, pathContact, type MovePath } from "./pickups.ts";
import { stepPlayerMove } from "./movement.ts";
import { generateMaze } from "./maze-gen.ts";
import { findSpawnCells } from "./spawn.ts";

const line = (x: number, end: number): MovePath => [{ position: { x, y: 1.5 }, time: 0 }, { position: { x: end, y: 1.5 }, time: 1 }];
test("T7 every contact row and exact independent effect boundaries", () => {
  for (const global of [0, 100]) for (const hunter of [0, 100]) for (const runner of [0, 100]) {
    const expected = global && !hunter ? "hunter" : runner ? "blocked" : "runner";
    assert.equal(contactOutcome(99, global, hunter, runner), expected);
    assert.equal(contactOutcome(100, global, hunter, runner), "runner");
  }
  assert.equal(contactOutcome(100, 200, 100, 200), "hunter", "hunter shield expires within global window regardless of runner shield");
  assert.equal(effectActive(99, 100), true);
  assert.equal(effectActive(100, 100), false);
  assert.equal(effectActive(101, 100), false);
});
test("T7 refresh never stacks and 0/8/18 schedule is independent of shields", () => {
  assert.deepEqual(pickupTiming("speed", 0), { endsAt: 5000, nextSpawnAt: 15000 });
  assert.deepEqual(pickupTiming("shield", 0), { endsAt: 3000, nextSpawnAt: 15000 });
  assert.deepEqual(pickupTiming("vulnerability", 0), { endsAt: 8000, nextSpawnAt: 18000 });
  assert.deepEqual(pickupTiming("vulnerability", 2000), { endsAt: 10000, nextSpawnAt: 20000 });
  assert.equal(pickupTiming("speed", 2000).endsAt, 7000);
});
test("T7 seeded priority, earliest arrival, exact tie, hunter exclusion", () => {
  const players = [{ id: "h", team: "hunter" as const, path: line(1.5, 5.5) }, { id: "r", team: "runner" as const, path: line(5.5, 1.5) }];
  assert.deepEqual(pickupClaim("speed", 3, 1, players, ["r", "h"]), { id: "r", time: 0.5 });
  assert.deepEqual(pickupClaim("speed", 3, 1, [...players].reverse(), ["h", "r"]), { id: "h", time: 0.5 });
  assert.equal(pickupClaim("vulnerability", 2, 1, players, ["h", "r"])?.id, "r");
  assert.equal(pickupClaim("shield", 2, 1, players, ["r", "h"])?.id, "h");
  assert.deepEqual(seededPriority(["c", "b", "a"], pickupRandom(42)), seededPriority(["a", "c", "b"], pickupRandom(42)));
});
test("T7 true movement paths preserve fast crossings, corners and wall arrival time", () => {
  const maze = ["#####", "#...#", "###.#", "###.#", "#####"];
  const path: { position: { x: number; y: number }; time: number }[] = [];
  const end = stepPlayerMove({ position: { x: 1.5, y: 1.5 }, direction: "right", queuedDirection: "down" }, 6, 1, maze, path);
  assert.deepEqual(end.position, { x: 3.5, y: 3.5 });
  assert.equal(pickupArrival(path, 2, 1), 1 / 6);
  assert.equal(pickupArrival(path, 3, 2), 0.5);
  assert.equal(pickupArrival(path, 2, 2), null, "do not cut across corner");
  assert.equal(pickupArrival(path, 3, 3), 2 / 3, "wall stop must not stretch travel time");
  assert.notEqual(pathContact(line(1.5, 8.5), line(8.5, 1.5)), null);
});
test("T7 safe deterministic distinct reachable spawns, exhausted-cell retry", () => {
  for (const seed of [1, 42, 424242]) {
    const maze = generateMaze(seed), spawns = findSpawnCells(maze);
    const origin = { x: spawns.hunter[0]!.col + 0.5, y: spawns.hunter[0]!.row + 0.5 };
    const excluded = [...spawns.hunter, ...spawns.runner].map(c => ({ x: c.col + 0.5, y: c.row + 0.5 }));
    const random = pickupRandom(seed);
    for (let i = 0; i < 3; i++) {
      const cell = pickupCell(maze, origin, excluded, random)!;
      assert.ok(cell);
      assert.ok(!excluded.some(p => Math.floor(p.x) === cell.col && Math.floor(p.y) === cell.row));
      excluded.push({ x: cell.col + 0.5, y: cell.row + 0.5 });
    }
  }
  const maze = ["#####", "#.#.#", "#####"];
  assert.equal(pickupCell(maze, { x: 1.5, y: 1.5 }, [{ x: 1.5, y: 1.5 }], () => 0), null);
  assert.deepEqual(pickupCell(maze, { x: 1.5, y: 1.5 }, [], () => 0), { col: 1, row: 1 });
});
