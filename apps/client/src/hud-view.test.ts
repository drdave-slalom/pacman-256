import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameRoomSnapshot, PlayerSnapshot } from "@maze/shared";
import {
  aliveCounts,
  canSteer,
  countdownRemaining,
  formatClock,
  isLocalEliminated,
  isMazePhase,
  resultView,
  roundTimeRemaining,
} from "./hud-view.ts";

function player(id: string, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id,
    displayName: id.toUpperCase(),
    team: "unassigned",
    alive: true,
    x: 1.5,
    y: 1.5,
    direction: "left",
    queuedDirection: "",
    lastInputSequence: -1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GameRoomSnapshot> = {}): GameRoomSnapshot {
  return {
    protocolVersion: 1,
    roomCode: "abc123",
    hostPlayerId: "a",
    phase: "lobby",
    revision: 1,
    serverTime: 1_000_000,
    roundId: "",
    mazeSeed: 0,
    countdownEndsAt: 0,
    roundEndsAt: 0,
    resultWinner: "",
    resultReason: "",
    resultEndedAt: 0,
    players: { a: player("a", { team: "hunter" }), b: player("b", { team: "runner", x: 3.5 }) },
    ...overrides,
  };
}

test("isMazePhase is true for countdown/playing/results with a round ID, false otherwise", () => {
  assert.equal(isMazePhase(snapshot()), false, "lobby is not a maze phase");
  assert.equal(isMazePhase(snapshot({ phase: "countdown" })), false, "countdown without a round");
  assert.equal(isMazePhase(snapshot({ phase: "playing" })), false, "playing without a round");
  assert.equal(isMazePhase(snapshot({ phase: "results", resultWinner: "hunter" })), false, "results without a round");
  assert.equal(isMazePhase(snapshot({ phase: "countdown", roundId: "r1" })), true);
  assert.equal(isMazePhase(snapshot({ phase: "playing", roundId: "r1" })), true);
  assert.equal(isMazePhase(snapshot({ phase: "results", roundId: "r1", resultWinner: "hunter", resultReason: "teamEliminated" })), true);
});

test("formatClock renders m:ss and clamps negatives", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-500), "0:00");
  assert.equal(formatClock(999), "0:00");
  assert.equal(formatClock(1_000), "0:01");
  assert.equal(formatClock(59_999), "0:59");
  assert.equal(formatClock(60_000), "1:00");
  assert.equal(formatClock(180_000), "3:00");
  assert.equal(formatClock(3_599_999), "59:59");
  assert.equal(formatClock(3_600_000), "60:00");
});

test("countdownRemaining derives whole seconds from server fields, clamped at 0", () => {
  const base = { phase: "countdown" as const, roundId: "r1" };
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_000_000, countdownEndsAt: 1_003_000 })), 3);
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_000_001, countdownEndsAt: 1_003_000 })), 3);
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_001_000, countdownEndsAt: 1_003_000 })), 2);
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_002_999, countdownEndsAt: 1_003_000 })), 1);
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_003_000, countdownEndsAt: 1_003_000 })), 0);
  assert.equal(countdownRemaining(snapshot({ ...base, serverTime: 1_004_000, countdownEndsAt: 1_003_000 })), 0, "clamped at 0");
  assert.equal(countdownRemaining(snapshot({ phase: "playing", roundId: "r1" })), 0, "not counting down");
});

test("roundTimeRemaining is the server deadline minus server time, clamped, display-only", () => {
  const playing = { phase: "playing" as const, roundId: "r1" };
  assert.equal(roundTimeRemaining(snapshot({ ...playing, serverTime: 1_000_000, roundEndsAt: 1_180_000 })), 180_000);
  assert.equal(roundTimeRemaining(snapshot({ ...playing, serverTime: 1_100_000, roundEndsAt: 1_180_000 })), 80_000);
  assert.equal(roundTimeRemaining(snapshot({ ...playing, serverTime: 1_181_000, roundEndsAt: 1_180_000 })), 0, "clamped at 0");
  assert.equal(roundTimeRemaining(snapshot({ phase: "results", roundId: "r1" })), 0, "results freeze the timer");
  assert.equal(roundTimeRemaining(snapshot({ phase: "countdown", roundId: "r1" })), 0);
});

test("aliveCounts counts alive players per team, ignoring unassigned and eliminated", () => {
  const playing = {
    phase: "playing" as const,
    roundId: "r1",
    players: {
      a: player("a", { team: "hunter" }),
      b: player("b", { team: "hunter", alive: false }),
      c: player("c", { team: "runner" }),
      d: player("d", { team: "runner", alive: false }),
      e: player("e"),
    },
  };
  assert.deepEqual(aliveCounts(snapshot(playing)), { hunter: 1, runner: 1 });
});

test("canSteer requires an alive local player during playing with a round ID", () => {
  const playing = { phase: "playing" as const, roundId: "r1" };
  assert.equal(canSteer(snapshot(playing), "a"), true);
  assert.equal(canSteer(snapshot({ ...playing, players: { a: player("a", { team: "hunter", alive: false }) } }), "a"), false, "eliminated cannot steer");
  assert.equal(canSteer(snapshot({ ...playing, players: { a: player("a", { team: "hunter" }) } }), "missing"), false);
  assert.equal(canSteer(snapshot({ ...playing, roundId: "" }), "a"), false, "no round");
  assert.equal(canSteer(snapshot({ phase: "countdown", roundId: "r1" }), "a"), false);
  assert.equal(canSteer(snapshot({ phase: "results", roundId: "r1", resultWinner: "hunter", resultReason: "teamEliminated" }), "a"), false);
  assert.equal(canSteer(snapshot({ phase: "lobby" }), "a"), false);
});

test("isLocalEliminated reflects the local player's alive flag", () => {
  assert.equal(isLocalEliminated(snapshot({ phase: "playing", roundId: "r1" }), "a"), false);
  assert.equal(
    isLocalEliminated(snapshot({ phase: "playing", roundId: "r1", players: { a: player("a", { team: "hunter", alive: false }) } }), "a"),
    true,
  );
  assert.equal(isLocalEliminated(snapshot(), "missing"), false);
});

test("resultView is null outside the results phase (no local winner guessing)", () => {
  for (const phase of ["lobby", "countdown", "playing"] as const) {
    assert.equal(
      resultView(snapshot({ phase, roundId: phase === "lobby" ? "" : "r1", resultWinner: "hunter", resultReason: "teamEliminated" })),
      null,
      `no result view in ${phase}`,
    );
  }
});

test("resultView reports the server winner and reason in results", () => {
  const cases = [
    ["hunter", "teamEliminated", "Hunters win", "all runners eliminated", "Round over: Hunters win: all runners eliminated."],
    ["runner", "teamEliminated", "Runners win", "all hunters eliminated", "Round over: Runners win: all hunters eliminated."],
    ["runner", "timeout", "Runners win", "survived to the deadline", "Round over: Runners win: survived to the deadline."],
    ["none", "simultaneousWipe", "Draw", "both teams eliminated at once", "Round over: Draw: both teams eliminated at once."],
    ["none", "abandoned", "No winner", "all players left", "Round over: No winner: all players left."],
  ] as const;
  for (const [resultWinner, resultReason, winner, reason, line] of cases) {
    const view = resultView(snapshot({ phase: "results", roundId: "r1", resultWinner, resultReason }));
    assert.ok(view);
    assert.deepEqual(view, { winner, reason, line });
  }
});

test("resultView falls back to a generic line for empty or unknown result fields", () => {
  assert.deepEqual(resultView(snapshot({ phase: "results", roundId: "r1", resultWinner: "", resultReason: "" })), {
    winner: "",
    reason: "",
    line: "Round over.",
  });
  assert.deepEqual(resultView(snapshot({ phase: "results", roundId: "r1", resultWinner: "hunter", resultReason: "timeout" })), {
    winner: "",
    reason: "",
    line: "Round over.",
  });
});
