import assert from "node:assert/strict";
import { test } from "node:test";
import { pathPosition, pickupArrival, pickupClaim, stepPlayerMove, type PathPoint } from "@maze/shared";
import { resolveContacts, resolveProtectedMovement, type StepMove } from "./game-room.ts";

function permutations<T>(values: readonly T[]): T[][] {
  return values.length === 0 ? [[]] : values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));
}

function plannedMove(id: string, team: "hunter" | "runner", x: number, direction: "right" | "left", speed = 4, shieldEndsAt = 0): StepMove {
  const from = { x, y: 1.5 };
  const path: PathPoint[] = [];
  const next = stepPlayerMove({ position: from, direction, queuedDirection: null }, speed, 1 / 30,
    ["########", "#.....##", "########"], path);
  return { id, team, from, to: next.position, path, shieldEndsAt };
}

for (const speed of [4, 6]) {
  test(`T7 cycle 1: four-player protected chain reaches stable separation at ${speed} tiles/s for every iteration order`, () => {
    // Reviewer reproduction: the old two passes left H0 only 0.526667
    // tiles behind R1. R3 is stationary against the wall at x=5.5.
    const moves = [
      plannedMove("H0", "hunter", 3.64, "right", speed),
      plannedMove("R1", "runner", 4.26, "right", speed, 100),
      plannedMove("H2", "hunter", 4.88, "right", speed),
      plannedMove("R3", "runner", 5.5, "right", speed, 100),
    ];
    const original = structuredClone(moves);
    for (const order of permutations(moves)) {
      const result = resolveProtectedMovement(order, 0);
      for (const [id, expected] of [["H0", 3.7], ["R1", 4.3], ["H2", 4.9], ["R3", 5.5]] as const) {
        assert.ok(Math.abs(result.find(move => move.id === id)!.to.x - expected) < 1e-10, `${id} stops at ${expected}`);
      }
      for (let sample = 0; sample <= 100; sample++) {
        for (const hunter of result.filter(move => move.team === "hunter")) {
          for (const runner of result.filter(move => move.team === "runner")) {
            const h = pathPosition(hunter.path!, sample / 100), r = pathPosition(runner.path!, sample / 100);
            assert.ok(Math.hypot(h.x - r.x, h.y - r.y) >= 0.6 - 1e-10, "no intermediate penetration");
          }
        }
      }
      assert.deepEqual(resolveProtectedMovement(result, 0).map(move => move.to), result.map(move => move.to), "already stable");
      assert.equal(resolveContacts(result, 0).size, 0);
    }
    assert.deepEqual(moves, original, "solver does not mutate planned paths");
  });
}

test("T7 cycle 1: finalized arrivals survive newly awarded shield, including contested earlier arrival", () => {
  for (const contested of [false, true]) {
    const moves = [plannedMove("H", "hunter", 1.9, "right"), plannedMove("R", "runner", 2.55, "left")];
    if (contested) moves.push(plannedMove("R2", "runner", 2.6, "left"));
    for (const order of permutations(moves)) {
      const resolved = resolveProtectedMovement(order, 0);
      // H/R touch at 6.25ms; R reaches the shield at 12.5ms, R2 at
      // 25ms. Movement precedes pickup awards, so neither arrival is erased
      // by the new protection. Seed priority must not override earlier arrival.
      const claim = pickupClaim("shield", 2, 1, resolved.map(move => ({ ...move, path: move.path! })), ["R2", "H", "R"]);
      assert.equal(claim?.id, "R");
      assert.ok(Math.abs(claim!.time / 30 - 0.0125) < 1e-12);
      const runner = resolved.find(move => move.id === "R")!;
      assert.ok(Math.abs(pickupArrival(runner.path!, 2, 1)! / 30 - 0.0125) < 1e-12);
      assert.ok(Math.abs(runner.to.x - (2.55 - 4 / 30)) < 1e-12, "not rewound to 2.525");
      runner.shieldEndsAt = 3000 + claim!.time * 1000 / 30;
      const eliminated = resolveContacts(resolved, 1000 / 30);
      assert.equal(eliminated.has("R"), false, "new shield governs same-step combat");
      assert.equal(eliminated.has("H"), false);
      if (contested) assert.equal(eliminated.has("R2"), true, "other contact uses the same post-pickup snapshot");
    }
  }
});
