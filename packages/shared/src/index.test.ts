import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GAME_RULES,
  PROTOCOL_VERSION,
  isConnectionState,
  isProtocolCompatible,
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
