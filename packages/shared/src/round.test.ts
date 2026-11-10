import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MOVE_SPEED_TILES_PER_SECOND } from "./movement.ts";
import { SIMULATION_DT_SECONDS } from "./protocol.ts";
import { CONTACT_DISTANCE_TILES, evaluateRoundOutcome, sweptContact } from "./round.ts";

const v = (x: number, y: number) => ({ x, y });

test("stationary overlap is contact", () => {
  assert.equal(sweptContact(v(1.5, 1.5), v(1.5, 1.5), v(1.7, 1.5), v(1.7, 1.5)), true);
});

test("players out of range are not in contact", () => {
  assert.equal(sweptContact(v(1.5, 1.5), v(1.6, 1.5), v(3.5, 1.5), v(3.4, 1.5)), false);
});

test("head-on swap within one step is contact", () => {
  assert.equal(sweptContact(v(1.5, 1.5), v(2.5, 1.5), v(2.5, 1.5), v(1.5, 1.5)), true);
});

test("head-on crossing at real per-tick speed is contact", () => {
  const step = DEFAULT_MOVE_SPEED_TILES_PER_SECOND * SIMULATION_DT_SECONDS;
  const gap = step + CONTACT_DISTANCE_TILES;
  // A moves right one step, B moves left one step; they close to contact range within one maximum step.
  assert.equal(sweptContact(v(1.5, 1.5), v(1.5 + step, 1.5), v(1.5 + gap, 1.5), v(1.5 + gap - step, 1.5)), true);
  // Just beyond two steps + contact distance apart, one step each never reaches contact range.
  const far = 2 * step + CONTACT_DISTANCE_TILES + 0.01;
  assert.equal(sweptContact(v(1.5, 1.5), v(1.5 + step, 1.5), v(1.5 + far, 1.5), v(1.5 + far - step, 1.5)), false);
});

test("swap with steps larger than contact distance is contact", () => {
  const step = 1.5;
  assert.ok(step > CONTACT_DISTANCE_TILES);
  // Each player moves past the other: endpoints are out of range, but the swept paths cross.
  assert.equal(sweptContact(v(1.5, 1.5), v(1.5 + step, 1.5), v(1.5 + step, 1.5), v(1.5, 1.5)), true);
});

test("perpendicular crossing is contact", () => {
  // A moves right through (2.5, 2.5); B moves down through the same point at the same time.
  assert.equal(sweptContact(v(1.5, 2.5), v(3.5, 2.5), v(2.5, 1.5), v(2.5, 3.5)), true);
  // Same paths, but B passes the crossing well after A has left.
  assert.equal(sweptContact(v(1.5, 2.5), v(3.5, 2.5), v(2.5, -0.5), v(2.5, 1.5)), false);
});

test("exact contact distance is inclusive", () => {
  const d = CONTACT_DISTANCE_TILES;
  assert.equal(sweptContact(v(0, 0), v(0, 0), v(d, 0), v(d, 0)), true);
  assert.equal(sweptContact(v(0, 0), v(0, 0), v(d + 1e-9, 0), v(d + 1e-9, 0)), false);
  // Closest approach mid-step exactly at the distance.
  assert.equal(sweptContact(v(0, 0), v(0, 0), v(-1, 0.5), v(1, 0.5), 0.5), true);
});

const alive = { huntersAlive: 1, runnersAlive: 1, huntersAliveBefore: 1, runnersAliveBefore: 1, deadlineReached: false };

test("evaluateRoundOutcome covers every branch", () => {
  assert.deepEqual(
    evaluateRoundOutcome({ ...alive, huntersAlive: 0, runnersAlive: 0, huntersAliveBefore: 0, runnersAliveBefore: 0 }),
    { winner: "none", reason: "abandoned" },
  );
  assert.deepEqual(evaluateRoundOutcome({ ...alive, huntersAlive: 0, runnersAlive: 0 }), {
    winner: "none",
    reason: "simultaneousWipe",
  });
  assert.deepEqual(evaluateRoundOutcome({ ...alive, runnersAlive: 0 }), { winner: "hunter", reason: "teamEliminated" });
  assert.deepEqual(evaluateRoundOutcome({ ...alive, huntersAlive: 0 }), { winner: "runner", reason: "teamEliminated" });
  assert.deepEqual(evaluateRoundOutcome({ ...alive, deadlineReached: true }), { winner: "runner", reason: "timeout" });
  assert.equal(evaluateRoundOutcome(alive), null);
});
