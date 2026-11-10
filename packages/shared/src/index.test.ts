import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISPLAY_NAME_MAX_LENGTH,
  GAME_ROOM,
  GAME_RULES,
  JOIN_ERROR_CODES,
  PROTOCOL_VERSION,
  describeJoinError,
  isConnectionState,
  isJoinErrorCode,
  isProtocolCompatible,
  isValidDisplayName,
  parseAppRoute,
  serializeAppRoute,
} from "./index.ts";

test("protocol compatibility requires an exact numeric version", () => {
  assert.equal(isProtocolCompatible(PROTOCOL_VERSION), true);
  for (const value of [undefined, null, "1", {}, PROTOCOL_VERSION + 1]) {
    assert.equal(isProtocolCompatible(value), false);
  }
});

test("connection state requires a compatible server lobby snapshot", () => {
  assert.equal(
    isConnectionState({ protocolVersion: PROTOCOL_VERSION, phase: "lobby" }),
    true,
  );
  for (const value of [
    null,
    {},
    { protocolVersion: "1", phase: "lobby" },
    { protocolVersion: PROTOCOL_VERSION, phase: "unexpected" },
  ]) {
    assert.equal(isConnectionState(value), false);
  }
});

test("lobby room name targets the shared game room contract", () => {
  assert.equal(GAME_ROOM, "game-room");
});

test("display name validation accepts trimmed bounded names without control chars", () => {
  assert.equal(isValidDisplayName("Alice"), true);
  assert.equal(isValidDisplayName("  Alice  "), true);
  assert.equal(isValidDisplayName("A".repeat(DISPLAY_NAME_MAX_LENGTH)), true);
  assert.equal(isValidDisplayName("🔥"), true);
  assert.equal(isValidDisplayName(""), false);
  assert.equal(isValidDisplayName("   "), false);
  assert.equal(
    isValidDisplayName("A".repeat(DISPLAY_NAME_MAX_LENGTH + 1)),
    false,
  );
  assert.equal(isValidDisplayName("Ali\tce"), false);
  assert.equal(isValidDisplayName("Ali\nce"), false);
  assert.equal(isValidDisplayName("Ali\u0000ce"), false);
  assert.equal(isValidDisplayName("Ali\u007fce"), false);
  assert.equal(isValidDisplayName("Ali\u0085ce"), false);
  assert.equal(isValidDisplayName(42), false);
  assert.equal(isValidDisplayName(null), false);
  assert.equal(isValidDisplayName(undefined), false);
});

test("join error code set covers the contract's visible join/login codes", () => {
  for (const code of Object.values(JOIN_ERROR_CODES)) {
    assert.equal(isJoinErrorCode(code), true);
  }
  assert.equal(isJoinErrorCode("NOT_A_CODE"), false);
  assert.equal(isJoinErrorCode(520), false);
  assert.equal(isJoinErrorCode(undefined), false);
});

test("describeJoinError maps contract codes and matchmaking numbers", () => {
  assert.match(describeJoinError(JOIN_ERROR_CODES.ROOM_NOT_FOUND), /not found/i);
  assert.match(describeJoinError(JOIN_ERROR_CODES.ROOM_FULL), /full/i);
  assert.match(
    describeJoinError(JOIN_ERROR_CODES.PROTOCOL_MISMATCH),
    /protocol/i,
  );
  assert.match(describeJoinError(JOIN_ERROR_CODES.RATE_LIMITED), /too many/i);

  // Numeric Colyseus matchmaking codes (neutral copy that stays accurate after
  // T3 lands).
  const matchmakeTable: Array<[number, RegExp]> = [
    [520, /room service not available/i],
    [521, /no matching room/i],
    [522, /room not found on the server/i],
    [523, /could not handle/i],
    [524, /expired/i],
    [525, /credentials/i],
    [526, /application error/i],
    [4217, /payload/i],
  ];
  for (const [code, pattern] of matchmakeTable) {
    assert.match(describeJoinError(code), pattern, `code ${code}`);
  }
  assert.match(describeJoinError("520"), /room service not available/i);
  assert.match(describeJoinError("522"), /room not found on the server/i);

  // A known numeric code takes precedence over a message that embeds a
  // different contract code (numeric mapping is consulted before the message
  // scan).
  assert.match(
    describeJoinError(522, "ROOM_FULL: try another room"),
    /room not found on the server/i,
  );

  // Message-embedded contract codes are recognized (e.g. connection-room's
  // "PROTOCOL_MISMATCH: reload with a compatible client.").
  assert.match(
    describeJoinError(400, "PROTOCOL_MISMATCH: reload with a compatible client."),
    /protocol/i,
  );

  assert.match(describeJoinError("WAT"), /could not join/i);
  assert.equal(describeJoinError(), "Could not join the room. Try again.");
});

test("app route hash parsing covers lobby, prototype, and room views", () => {
  assert.deepEqual(parseAppRoute(""), { view: "lobby" });
  assert.deepEqual(parseAppRoute("#"), { view: "lobby" });
  assert.deepEqual(parseAppRoute("#play"), { view: "prototype" });
  assert.deepEqual(parseAppRoute(" #play "), { view: "prototype" });
  assert.deepEqual(parseAppRoute("#room=ABC123"), {
    view: "room",
    code: "ABC123",
  });
  assert.deepEqual(parseAppRoute("#room=A%20B"), {
    view: "room",
    code: "A B",
  });
  assert.deepEqual(parseAppRoute("#room="), { view: "lobby" });
  assert.deepEqual(parseAppRoute("#garbage"), { view: "lobby" });
});

test("app route serialization round-trips with the parsing", () => {
  assert.equal(serializeAppRoute({ view: "lobby" }), "");
  assert.equal(serializeAppRoute({ view: "prototype" }), "#play");
  assert.equal(serializeAppRoute({ view: "room", code: "ABC123" }), "#room=ABC123");
  assert.equal(serializeAppRoute({ view: "room", code: "A B" }), "#room=A%20B");
  assert.deepEqual(
    parseAppRoute(serializeAppRoute({ view: "room", code: "Q*W" })),
    { view: "room", code: "Q*W" },
  );
});

test("shared tuning matches the approved initial timing", () => {
  assert.equal(GAME_RULES.speedMultiplier, 1.5);
  assert.equal(GAME_RULES.roundDurationMs, 180_000);
  assert.equal(GAME_RULES.countdownMs, 3_000);
  assert.equal(GAME_RULES.speedDurationMs, 5_000);
  assert.equal(GAME_RULES.shieldDurationMs, 3_000);
  assert.equal(
    GAME_RULES.vulnerabilityDurationMs + GAME_RULES.vulnerabilityRespawnDelayMs,
    18_000,
  );
  assert.equal(GAME_RULES.standardPickupRespawnMs, 15_000);
  assert.equal(GAME_RULES.maxPlayers, 4);
});
