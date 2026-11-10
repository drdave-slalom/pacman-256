import assert from "node:assert/strict";
import { test } from "node:test";
import type { Direction } from "./index.ts";
import {
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  createPlayerMoveState,
  stepPlayerMove,
} from "./movement.ts";
import type { PlayerMoveState } from "./movement.ts";
import { MAZE_HEIGHT, MAZE_WIDTH, PLAYER_SPAWN, isWalkable } from "./map.ts";

function stateAt(
  x: number,
  y: number,
  direction: Direction,
  queuedDirection: Direction | null = null,
): PlayerMoveState {
  return { position: { x, y }, direction, queuedDirection };
}

test("default movement speed is the approved 4 tiles per second", () => {
  assert.equal(DEFAULT_MOVE_SPEED_TILES_PER_SECOND, 4);
});

test("createPlayerMoveState places the player at the spawn center", () => {
  const state = createPlayerMoveState();
  assert.equal(state.position.x, PLAYER_SPAWN.col + 0.5);
  assert.equal(state.position.y, PLAYER_SPAWN.row + 0.5);
  assert.equal(state.queuedDirection, null);
});

test("moving into a wall stops centered in the current cell", () => {
  // Row 2: walkable column 1, wall at column 2.
  const out = stepPlayerMove(stateAt(1.5, 2.5, "right"), 4, 10);
  assert.equal(out.position.x, 1.5);
  assert.equal(out.position.y, 2.5);
  assert.equal(out.direction, "right");
  assert.equal(out.queuedDirection, null);
});

test("a short step advances partway through an open cell", () => {
  // Row 1 is an open corridor; the next cell is walkable, so a partial step
  // is allowed before the corridor center.
  const out = stepPlayerMove(stateAt(1.5, 1.5, "right"), 4, 0.1);
  assert.equal(out.position.x, 1.9);
  assert.equal(out.position.y, 1.5);
});

test("actors never exit the maze bounds (stopping centered)", () => {
  const cases: Array<{ start: [number, number]; direction: Direction; axis: "x" | "y"; center: number }> = [
    { start: [1.5, 1.5], direction: "up", axis: "y", center: 1.5 },
    { start: [1.5, 8.5], direction: "down", axis: "y", center: 9.5 },
    { start: [1.5, 1.5], direction: "left", axis: "x", center: 1.5 },
    { start: [13.5, 1.5], direction: "right", axis: "x", center: 13.5 },
  ];
  for (const c of cases) {
    const out = stepPlayerMove(stateAt(c.start[0], c.start[1], c.direction), 4, 10);
    assert.equal(out.position[c.axis], c.center);
    assert.ok(out.position.x >= 0 && out.position.x < MAZE_WIDTH);
    assert.ok(out.position.y >= 0 && out.position.y < MAZE_HEIGHT);
  }
});

test("a queued perpendicular turn executes at a legal junction", () => {
  // Row 5 corridor: up from column 2 is a wall, up from column 3 is open.
  const out = stepPlayerMove(stateAt(2.5, 5.5, "right", "up"), 4, 0.75);
  assert.equal(out.direction, "up");
  assert.equal(out.queuedDirection, null);
  assert.equal(out.position.x, 3.5); // turned at the column 3 junction
  assert.equal(out.position.y, 3.5); // then traveled up
});

test("a queued perpendicular turn keeps working after the junction", () => {
  const out = stepPlayerMove(stateAt(2.5, 5.5, "right", "up"), 4, 2);
  assert.equal(out.direction, "up");
  assert.equal(out.position.x, 3.5);
  assert.equal(out.position.y, 3.5); // stopped centered at row 3; row 2 col 3 is a wall
});

test("a queued perpendicular does not turn where it is illegal", () => {
  // Row 1 runs left-to-right; above row 1 is the border wall everywhere.
  const out = stepPlayerMove(stateAt(1.5, 1.5, "right", "up"), 4, 1);
  assert.equal(out.direction, "right");
  assert.equal(out.position.x, 5.5);
  assert.equal(out.queuedDirection, "up"); // still buffered, not applied
});

test("releasing the control does not stop movement", () => {
  const out = stepPlayerMove(stateAt(1.5, 1.5, "right"), 4, 1);
  assert.equal(out.position.x, 5.5);
  assert.equal(out.position.y, 1.5);
  assert.equal(out.direction, "right");
  assert.equal(out.queuedDirection, null);
});

test("pressing the opposite direction reverses immediately", () => {
  const out = stepPlayerMove(stateAt(3.5, 5.5, "right", "left"), 4, 0.5);
  assert.equal(out.direction, "left");
  assert.equal(out.queuedDirection, null);
  assert.equal(out.position.x, 1.5);
  assert.equal(out.position.y, 5.5);
});

test("reversal works while stopped against a wall", () => {
  const blocked = stepPlayerMove(stateAt(1.5, 2.5, "right"), 4, 10);
  assert.equal(blocked.position.x, 1.5);
  assert.equal(blocked.position.y, 2.5);
  const reversed = stepPlayerMove({ ...blocked, queuedDirection: "left" }, 4, 0.5);
  assert.equal(reversed.direction, "left");
  // Column 0 is the border wall, so the reversal stays centered in cell (1,2)
  // rather than moving onto the wall.
  assert.equal(reversed.position.x, 1.5);
  assert.equal(reversed.position.y, 2.5);
});

test("pressing the same direction is a no-op", () => {
  const out = stepPlayerMove(stateAt(1.5, 1.5, "right", "right"), 4, 1);
  assert.equal(out.direction, "right");
  assert.equal(out.queuedDirection, null);
  assert.equal(out.position.x, 5.5);
});

test("while blocked against a wall, a legal perpendicular turn fires from the wall", () => {
  // Row 2, cell (1,2): blocked right by wall (2,2); down to (1,3) is open.
  const blocked = stepPlayerMove(stateAt(1.5, 2.5, "right"), 4, 10);
  assert.equal(blocked.position.x, 1.5);
  assert.equal(blocked.position.y, 2.5);
  const turned = stepPlayerMove({ ...blocked, queuedDirection: "down" }, 4, 0.25);
  assert.equal(turned.direction, "down");
  assert.equal(turned.position.x, 1.5); // stays centered, no recentering hop
  assert.equal(turned.position.y, 3.5);
  assert.equal(turned.queuedDirection, null);
});

test("while blocked against a wall, an illegal perpendicular turn stays buffered", () => {
  // Column 1 vertical corridor: moving up stops centered at (1,1), where
  // left (0,1) and right (2,1) are both walls, so no perpendicular turn is
  // legal until the actor reverses.
  const blocked = stepPlayerMove(stateAt(1.5, 2.5, "up"), 4, 10);
  assert.equal(blocked.position.y, 1.5);
  assert.equal(blocked.position.x, 1.5);
  assert.equal(blocked.direction, "up");
  const still = stepPlayerMove({ ...blocked, queuedDirection: "left" }, 4, 1);
  assert.equal(still.direction, "up");
  assert.equal(still.position.y, 1.5);
  assert.equal(still.queuedDirection, "left"); // waiting for a legal turn
  const freed = stepPlayerMove({ ...still, queuedDirection: "down" }, 4, 0.5);
  assert.equal(freed.direction, "down");
  assert.equal(freed.queuedDirection, null);
  assert.equal(freed.position.y, 3.5);
});

test("dead-end resting keeps the actor centered after repeated large steps", () => {
  const deadEnd = stateAt(1.5, 2.5, "right");
  const first = stepPlayerMove(deadEnd, 4, 100);
  assert.equal(first.position.x, 1.5);
  assert.equal(first.position.y, 2.5);
  const second = stepPlayerMove(first, 4, 100);
  assert.equal(second.position.x, 1.5);
  assert.equal(second.position.y, 2.5);
});

test("no hop on turn from a dead end: the idle axis stays at the corridor center", () => {
  const blocked = stepPlayerMove(stateAt(1.5, 2.5, "right"), 4, 10);
  assert.equal(blocked.position.x, 1.5);
  const turned = stepPlayerMove({ ...blocked, queuedDirection: "down" }, 4, 0.25);
  assert.equal(turned.direction, "down");
  assert.equal(turned.position.x, 1.5); // no recentering hop on the turn step
  assert.equal(turned.position.y, 3.5); // traveled down one cell
});

test("invariant: every step keeps the actor in a walkable cell, centered when blocked", () => {
  let state = createPlayerMoveState(); // spawn (7.5, 5.5)
  state = { ...state, direction: "right" };
  const script: Array<{ queued: Direction | null; dt: number; note: string }> = [
    { queued: null, dt: 10, note: "run east to the dead end at (13.5, 5.5)" },
    { queued: "up", dt: 10, note: "turn up at the dead end and run to (13.5, 1.5)" },
    { queued: "down", dt: 10, note: "reverse and run south to (13.5, 9.5)" },
  ];
  for (const step of script) {
    state = stepPlayerMove({ ...state, queuedDirection: step.queued }, 4, step.dt);
    const col = Math.floor(state.position.x);
    const row = Math.floor(state.position.y);
    assert.ok(
      isWalkable(col, row),
      `${step.note}: occupied cell (${col},${row}) must be walkable`,
    );
    const ahead = {
      up: { col, row: row - 1 },
      down: { col, row: row + 1 },
      left: { col: col - 1, row },
      right: { col: col + 1, row },
    }[state.direction];
    if (!isWalkable(ahead.col, ahead.row)) {
      const axis = state.direction === "left" || state.direction === "right" ? "x" : "y";
      const center = axis === "x" ? col + 0.5 : row + 0.5;
      assert.equal(
        state.position[axis],
        center,
        `${step.note}: blocked stop must be centered on ${axis}`,
      );
    }
  }
});

test("step is pure and deterministic", () => {
  const input = stateAt(2.5, 5.5, "right", "up");
  const snapshot = JSON.stringify(input);
  const first = stepPlayerMove(input, 4, 0.75);
  const second = stepPlayerMove(input, 4, 0.75);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), snapshot);
});

test("zero time or zero speed means no movement", () => {
  assert.deepEqual(stepPlayerMove(stateAt(1.5, 1.5, "right"), 4, 0).position, {
    x: 1.5,
    y: 1.5,
  });
  assert.deepEqual(stepPlayerMove(stateAt(1.5, 1.5, "right"), 0, 1).position, {
    x: 1.5,
    y: 1.5,
  });
});

test("reversal still applies at zero time", () => {
  const out = stepPlayerMove(stateAt(1.5, 1.5, "right", "left"), 4, 0);
  assert.equal(out.direction, "left");
  assert.equal(out.queuedDirection, null);
  assert.equal(out.position.x, 1.5);
});
