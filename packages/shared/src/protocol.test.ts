import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  INPUT_RATE_LIMIT_WINDOW_MS,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  SIMULATION_DT_SECONDS,
  SIMULATION_HZ,
  errorMessage,
  joinErrorCode,
  joinErrorText,
  parseActionResult,
  parseChooseTeam,
  parseDisplayName,
  parseInputRejected,
  parseJoinOptions,
  parseSetDirection,
  parseStartMatch,
  readRequestId,
} from "./protocol.ts";

test("tunables are named and consistent", () => {
  assert.equal(SIMULATION_DT_SECONDS, 1 / SIMULATION_HZ);
  assert.ok(INPUT_RATE_LIMIT_MAX_MESSAGES > 0);
  assert.ok(INPUT_RATE_LIMIT_WINDOW_MS > 0);
  assert.ok(MAX_CLIENT_MESSAGES_PER_SECOND > INPUT_RATE_LIMIT_MAX_MESSAGES * (1_000 / INPUT_RATE_LIMIT_WINDOW_MS));
});

test("display names are trimmed, bounded, and free of control characters", () => {
  assert.equal(parseDisplayName("  Ada  "), "Ada");
  assert.equal(parseDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH)), "x".repeat(MAX_DISPLAY_NAME_LENGTH));
  assert.equal(parseDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1)), null);
  assert.equal(parseDisplayName("   "), null);
  assert.equal(parseDisplayName(""), null);
  assert.equal(parseDisplayName("a\u0000b"), null);
  assert.equal(parseDisplayName("a\nb"), null);
  assert.equal(parseDisplayName("a\u200Bb"), null, "zero-width space (Cf)");
  assert.equal(parseDisplayName("a\u202Eb"), null, "right-to-left override (Cf)");
  assert.equal(parseDisplayName("\u200B"), null);
  assert.equal(parseDisplayName("Zoë 🙂"), "Zoë 🙂");
  assert.equal(parseDisplayName(42), null);
});

test("join options require exactly a version and a valid name", () => {
  assert.deepEqual(parseJoinOptions({ protocolVersion: 1, displayName: " Bo " }), {
    protocolVersion: 1,
    displayName: "Bo",
  });
  for (const bad of [
    null,
    "x",
    [],
    { protocolVersion: 1 },
    { displayName: "Bo" },
    { protocolVersion: "1", displayName: "Bo" },
    { protocolVersion: 1.5, displayName: "Bo" },
    { protocolVersion: 1, displayName: "" },
    { protocolVersion: 1, displayName: "Bo", sessionId: "spoof" },
  ]) {
    assert.equal(parseJoinOptions(bad), null, JSON.stringify(bad));
  }
});

test("chooseTeam and startMatch validate request IDs and enums", () => {
  assert.deepEqual(parseChooseTeam({ requestId: "r1", team: "hunter" }), { requestId: "r1", team: "hunter" });
  assert.deepEqual(parseStartMatch({ requestId: "r2" }), { requestId: "r2" });
  const longId = "r".repeat(MAX_REQUEST_ID_LENGTH + 1);
  for (const bad of [
    undefined,
    "hunter",
    { requestId: "", team: "hunter" },
    { requestId: longId, team: "hunter" },
    { requestId: 7, team: "hunter" },
    { requestId: "r", team: "ghost" },
    { requestId: "r", team: "hunter", hostPlayerId: "me" },
  ]) {
    assert.equal(parseChooseTeam(bad), null, JSON.stringify(bad));
  }
  for (const bad of [null, {}, { requestId: "" }, { requestId: "r", phase: "playing" }]) {
    assert.equal(parseStartMatch(bad), null, JSON.stringify(bad));
  }
});

test("setDirection requires a round, a safe non-negative integer sequence, and a direction", () => {
  assert.deepEqual(parseSetDirection({ roundId: "a", sequence: 0, direction: "up" }), {
    roundId: "a",
    sequence: 0,
    direction: "up",
  });
  for (const bad of [
    null,
    42,
    { roundId: "a", sequence: -1, direction: "up" },
    { roundId: "a", sequence: 1.5, direction: "up" },
    { roundId: "a", sequence: Number.MAX_SAFE_INTEGER + 1, direction: "up" },
    { roundId: "a", sequence: "1", direction: "up" },
    { roundId: "a", sequence: 1, direction: "north" },
    { roundId: "", sequence: 1, direction: "up" },
    { roundId: "a", sequence: 1, direction: "up", x: 3, y: 4 },
    { roundId: "a", sequence: 1, direction: "up", speed: 99 },
  ]) {
    assert.equal(parseSetDirection(bad), null, JSON.stringify(bad));
  }
});

test("readRequestId recovers a correlation ID from malformed requests", () => {
  assert.equal(readRequestId({ requestId: "r9", team: "bad" }), "r9");
  assert.equal(readRequestId({ requestId: "" }), null);
  assert.equal(readRequestId("r9"), null);
});

test("server message validators accept only well-formed results", () => {
  assert.deepEqual(parseActionResult({ requestId: "r", accepted: true }), { requestId: "r", accepted: true });
  assert.deepEqual(parseActionResult({ requestId: "r", accepted: false, code: "TEAM_FULL", message: "m" }), {
    requestId: "r",
    accepted: false,
    code: "TEAM_FULL",
    message: "m",
  });
  assert.equal(parseActionResult({ requestId: "r", accepted: false, code: "NOPE", message: "m" }), null);
  assert.deepEqual(parseInputRejected({ code: "STALE_ROUND", message: "m" }), { code: "STALE_ROUND", message: "m" });
  assert.equal(parseInputRejected({ code: "STALE_ROUND" }), null);
});

test("every error code has a player-facing message", () => {
  for (const code of ERROR_CODES) {
    assert.ok(errorMessage(code).length > 0);
    assert.equal(ERROR_MESSAGES[code], errorMessage(code));
  }
});

test("joinErrorCode maps server prefixes and Colyseus built-in errors", () => {
  for (const code of ERROR_CODES) {
    assert.equal(joinErrorCode(Object.assign(new Error(joinErrorText(code)), { code: 400 })), code);
  }
  assert.equal(joinErrorCode({ code: 522, message: 'room "abc" not found' }), "ROOM_NOT_FOUND");
  assert.equal(joinErrorCode({ code: 522, message: 'room "abc" is locked' }), "ROOM_FULL");
  assert.equal(joinErrorCode({ code: 500, message: "abc is already full." }), "ROOM_FULL");
  assert.equal(joinErrorCode(new Error("Failed to fetch")), null);
  assert.equal(joinErrorCode({ message: "NOT_A_CODE: x" }), null);
  assert.equal(joinErrorCode(undefined), null);
  assert.equal(joinErrorCode("ROOM_FULL: x"), null);
});
