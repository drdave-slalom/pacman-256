import assert from "node:assert/strict";
import { test } from "node:test";
import { INPUT_RATE_LIMIT_MAX_MESSAGES } from "@maze/shared";
import type { GameRoomSnapshot, PlayerSnapshot } from "@maze/shared";
import {
  CLIENT_INPUT_BUDGET,
  CLOSE_WITH_ERROR,
  DirectionSender,
  PendingAction,
  isPlausibleRoomCode,
  Interpolator,
  isRoundActive,
  leaveMessage,
  mazeKey,
  playerViews,
  resultSummary,
} from "./session-model.ts";

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
    serverTime: 0,
    roundId: "",
    mazeSeed: 0,
    countdownEndsAt: 0,
    roundEndsAt: 0,
    resultWinner: "",
    resultReason: "",
    resultEndedAt: 0,
    players: { a: player("a"), b: player("b", { team: "runner", x: 3.5 }) },
    ...overrides,
  };
}

test("a round is active only while playing with a round ID, including seed 0", () => {
  assert.equal(isRoundActive(snapshot()), false);
  assert.equal(isRoundActive(snapshot({ phase: "playing" })), false);
  const playing = snapshot({ phase: "playing", roundId: "r1", mazeSeed: 0 });
  assert.equal(isRoundActive(playing), true);
  assert.equal(mazeKey(playing), "r1:0");
  assert.equal(mazeKey(snapshot({ roundId: "r1" })), null);
  assert.notEqual(mazeKey(playing), mazeKey({ ...playing, roundId: "r2" }));
  assert.notEqual(mazeKey(playing), mazeKey({ ...playing, mazeSeed: 7 }));
});

test("player views flag the local player and host in synchronized order", () => {
  const views = playerViews(snapshot({ hostPlayerId: "b" }), "a");
  assert.deepEqual(
    views.map(({ id, isLocal, isHost, team, x }) => ({ id, isLocal, isHost, team, x })),
    [
      { id: "a", isLocal: true, isHost: false, team: "unassigned", x: 1.5 },
      { id: "b", isLocal: false, isHost: true, team: "runner", x: 3.5 },
    ],
  );
});

test("direction sender dedupes, sequences from 0, and restarts per round", () => {
  const sender = new DirectionSender();
  assert.deepEqual(sender.next("r1", "up", 0), { roundId: "r1", sequence: 0, direction: "up" });
  assert.equal(sender.next("r1", "up", 10), null, "repeat of the same direction is not sent");
  assert.deepEqual(sender.next("r1", "left", 20), { roundId: "r1", sequence: 1, direction: "left" });
  assert.deepEqual(sender.next("r1", "up", 30), { roundId: "r1", sequence: 2, direction: "up" });
  assert.deepEqual(sender.next("r2", "up", 40), { roundId: "r2", sequence: 0, direction: "up" });
  assert.equal(sender.next("", "down", 50), null, "no input without a round");
});

test("direction sender payloads contain exactly the protocol keys", () => {
  const message = new DirectionSender().next("r1", "right", 0);
  assert.ok(message);
  assert.deepEqual(Object.keys(message).sort(), ["direction", "roundId", "sequence"]);
});

test("direction sender stays under the input rate limit", () => {
  const sender = new DirectionSender(2, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.ok(sender.next("r1", "down", 100));
  assert.equal(sender.next("r1", "left", 200), null, "third change inside the window is held back");
  assert.deepEqual(sender.next("r1", "left", 1_000), { roundId: "r1", sequence: 2, direction: "left" });
  assert.equal(sender.next("r1", "left", 2_500), null);
});

test("RATE_LIMITED re-holds the last direction so it is resent when budget frees", () => {
  const sender = new DirectionSender(2, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.ok(sender.next("r1", "left", 100));
  sender.onRateLimited();
  assert.equal(sender.hasHeld, true);
  assert.equal(sender.flush("r1", 500), null, "waits for budget");
  assert.deepEqual(sender.flush("r1", 1_000), { roundId: "r1", sequence: 2, direction: "left" });
  assert.equal(sender.hasHeld, false);
  assert.equal(sender.next("r1", "left", 1_100), null, "resent direction is deduped again");
});

test("RATE_LIMITED keeps a newer held direction instead of the last sent one", () => {
  const sender = new DirectionSender(1, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.equal(sender.next("r1", "right", 10), null);
  sender.onRateLimited();
  assert.deepEqual(sender.flush("r1", 1_000), { roundId: "r1", sequence: 1, direction: "right" });
});

test("default input budget stays below the server rate limit", () => {
  assert.ok(CLIENT_INPUT_BUDGET < INPUT_RATE_LIMIT_MAX_MESSAGES);
  assert.ok(CLIENT_INPUT_BUDGET > 0);
  const sender = new DirectionSender();
  const directions = ["up", "down"] as const;
  let sent = 0;
  for (let i = 0; i < INPUT_RATE_LIMIT_MAX_MESSAGES * 2; i += 1) {
    if (sender.next("r1", directions[i % 2]!, i)) {
      sent += 1;
    }
  }
  assert.equal(sent, CLIENT_INPUT_BUDGET, "a burst inside one window sends only the budget");
});

test("direction sender holds the latest blocked direction and flushes it when budget frees", () => {
  const sender = new DirectionSender(2, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.ok(sender.next("r1", "down", 100));
  assert.equal(sender.next("r1", "left", 200), null);
  assert.equal(sender.next("r1", "right", 300), null, "latest blocked direction replaces the held one");
  assert.equal(sender.hasHeld, true);
  assert.equal(sender.msUntilBudget(300), 700);
  assert.equal(sender.flush("r1", 999), null, "still over budget");
  assert.deepEqual(sender.flush("r1", 1_000), { roundId: "r1", sequence: 2, direction: "right" });
  assert.equal(sender.hasHeld, false);
  assert.equal(sender.flush("r1", 1_500), null, "nothing left to flush");
});

test("returning to the last sent direction cancels a held one", () => {
  const sender = new DirectionSender(1, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.equal(sender.next("r1", "left", 10), null);
  assert.equal(sender.next("r1", "up", 20), null);
  assert.equal(sender.hasHeld, false);
  assert.equal(sender.flush("r1", 2_000), null);
});

test("a held direction is dropped when the round changes", () => {
  const sender = new DirectionSender(1, 1_000);
  assert.ok(sender.next("r1", "up", 0));
  assert.equal(sender.next("r1", "left", 10), null);
  assert.equal(sender.flush("r2", 2_000), null, "never sent into another round");
  assert.equal(sender.hasHeld, false, "a flush for another round clears the held direction");
  assert.deepEqual(sender.next("r2", "down", 2_000), { roundId: "r2", sequence: 0, direction: "down" });
  assert.equal(sender.hasHeld, false);
});

test("pending action resolves on its correlated accept or reject only", () => {
  const pending = new PendingAction();
  assert.equal(pending.begin("chooseTeam-1"), true);
  assert.equal(pending.begin("chooseTeam-2"), false, "one request at a time");
  assert.equal(pending.onActionResult({ requestId: "other", accepted: true }), null, "wrong requestId ignored");
  assert.equal(pending.busy, true);
  assert.deepEqual(pending.onActionResult({ requestId: "chooseTeam-1", accepted: true }), { kind: "accepted" });
  assert.equal(pending.busy, false);

  assert.equal(pending.begin("startMatch-3"), true);
  assert.deepEqual(
    pending.onActionResult({
      requestId: "startMatch-3",
      accepted: false,
      code: "TEAMS_UNBALANCED",
      message: "x",
    }),
    { kind: "rejected", code: "TEAMS_UNBALANCED", message: "x" },
  );
  assert.equal(pending.busy, false);
});

test("an uncorrelated INVALID_INPUT ends the pending action; other rejections do not", () => {
  const pending = new PendingAction();
  assert.equal(pending.onInputRejected("INVALID_INPUT"), null, "nothing pending");
  pending.begin("chooseTeam-1");
  assert.equal(pending.onInputRejected("STALE_ROUND"), null);
  assert.equal(pending.onInputRejected("RATE_LIMITED"), null);
  assert.equal(pending.busy, true);
  assert.deepEqual(pending.onInputRejected("INVALID_INPUT"), { kind: "rejected", code: "INVALID_INPUT" });
  assert.equal(pending.busy, false);
});

test("pending action times out once and ignores late results", () => {
  const pending = new PendingAction();
  pending.begin("startMatch-1");
  assert.equal(pending.onTimeout("startMatch-0"), null, "an old timer does not end a newer request");
  assert.deepEqual(pending.onTimeout("startMatch-1"), { kind: "timeout" });
  assert.equal(pending.busy, false);
  assert.equal(pending.onActionResult({ requestId: "startMatch-1", accepted: true }), null, "late result ignored");
  assert.equal(pending.onTimeout("startMatch-1"), null);

  pending.begin("startMatch-2");
  assert.equal(pending.onActionResult({ requestId: "startMatch-1", accepted: true }), null, "late result of the timed-out request");
  assert.equal(pending.busy, true);
  pending.cancel();
  assert.equal(pending.busy, false);
});

test("room codes are validated before contacting the server", () => {
  assert.equal(isPlausibleRoomCode("aB3_x-9"), true);
  assert.equal(isPlausibleRoomCode(""), false);
  assert.equal(isPlausibleRoomCode("bad code"), false);
  assert.equal(isPlausibleRoomCode("../x"), false);
  assert.equal(isPlausibleRoomCode("<script>"), false);
});

test("interpolator glides between patches, snaps on large jumps, and drops removed players", () => {
  const interpolator = new Interpolator(50);
  interpolator.update([{ id: "a", x: 1.5, y: 1.5 }], 0);
  assert.deepEqual(interpolator.sample("a", 0), { x: 1.5, y: 1.5 });
  interpolator.update([{ id: "a", x: 2.5, y: 1.5 }], 100);
  assert.deepEqual(interpolator.sample("a", 100), { x: 1.5, y: 1.5 });
  assert.deepEqual(interpolator.sample("a", 125), { x: 2, y: 1.5 });
  assert.deepEqual(interpolator.sample("a", 500), { x: 2.5, y: 1.5 });
  interpolator.update([{ id: "a", x: 15.5, y: 9.5 }], 600);
  assert.deepEqual(interpolator.sample("a", 600), { x: 15.5, y: 9.5 }, "teleports snap");
  interpolator.update([], 700);
  assert.equal(interpolator.sample("a", 700), null);
});

test("leave messages explain unexpected disconnects only", () => {
  assert.equal(leaveMessage(4000, false), null);
  assert.equal(leaveMessage(1006, true), null);
  assert.match(leaveMessage(CLOSE_WITH_ERROR, false) ?? "", /too many messages/);
  assert.match(leaveMessage(1006, false) ?? "", /code 1006/);
});

test("result summary is null outside the results phase", () => {
  for (const phase of ["lobby", "countdown", "playing"] as const) {
    assert.equal(resultSummary(snapshot({ phase, resultWinner: "hunter", resultReason: "teamEliminated" })), null);
  }
});

test("result summary reports the server winner and reason", () => {
  const cases = [
    ["hunter", "teamEliminated", "Round over: Hunters win: all runners eliminated."],
    ["runner", "teamEliminated", "Round over: Runners win: all hunters eliminated."],
    ["runner", "timeout", "Round over: Runners win: survived to the deadline."],
    ["none", "simultaneousWipe", "Round over: Draw: both teams eliminated at once."],
    ["none", "abandoned", "Round over: no winner: all players left."],
  ] as const;
  for (const [resultWinner, resultReason, expected] of cases) {
    assert.equal(resultSummary(snapshot({ phase: "results", resultWinner, resultReason })), expected);
  }
});

test("result summary falls back to a generic line for empty or unexpected fields", () => {
  assert.equal(resultSummary(snapshot({ phase: "results", resultWinner: "", resultReason: "" })), "Round over.");
  assert.equal(resultSummary(snapshot({ phase: "results", resultWinner: "hunter", resultReason: "timeout" })), "Round over.");
});
