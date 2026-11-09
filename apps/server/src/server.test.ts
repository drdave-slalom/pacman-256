import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@colyseus/sdk";
import {
  CONNECTION_ROOM,
  PROTOCOL_VERSION,
  isConnectionState,
} from "@maze/shared";
import { createGameServer } from "./server.ts";

test("local server serves health and synchronizes a compatible Colyseus state", {
  timeout: 15_000,
}, async (t) => {
  const { server, httpServer } = createGameServer();
  t.after(() => server.gracefullyShutdown(false));
  await server.listen(0, "127.0.0.1");
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;

  await t.test("health endpoint uses the shared protocol", async () => {
    const response = await fetch(`${endpoint}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  const client = new Client(endpoint.replace("http:", "ws:"));
  await t.test("a real SDK connection receives authoritative state", async () => {
    const room = await client.create(CONNECTION_ROOM, {
      protocolVersion: PROTOCOL_VERSION,
    });
    try {
      const state = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No server state received")), 3_000);
        room.onStateChange.once((snapshot: unknown) => {
          clearTimeout(timer);
          resolve(snapshot);
        });
        room.onError((code, message) => {
          clearTimeout(timer);
          reject(new Error(`${code}: ${message}`));
        });
      });
      assert.equal(isConnectionState(state), true);
    } finally {
      await room.leave();
    }
  });

  await t.test("mismatched and missing versions are rejected", async () => {
    for (const options of [{ protocolVersion: PROTOCOL_VERSION + 1 }, {}]) {
      await assert.rejects(client.create(CONNECTION_ROOM, options), /PROTOCOL_MISMATCH/);
    }
  });
});
