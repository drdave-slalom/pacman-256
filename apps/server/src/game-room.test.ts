import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  CLIENT_MESSAGES,
  GAME_ROOM,
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  generateMaze,
  isWalkableIn,
  joinErrorCode,
  parseActionResult,
  parseInputRejected,
  type ActionResultMessage,
  type Direction,
  type ErrorCode,
  type GameRoomSnapshot,
  type InputRejectedMessage,
  type PlayerSnapshot,
} from "@maze/shared";
import { createGameServer } from "./server.ts";

const WAIT_MS = 3_000;
const TEST_SEED = 424_242;

interface Harness {
  client: Client;
  /** Create or join, track the room for cleanup, and resolve once the initial state is decoded. */
  create(displayName: string): Promise<Player>;
  join(code: string, displayName: string): Promise<Player>;
}

interface Player {
  room: Room;
  id: string;
  snapshot(): GameRoomSnapshot;
  waitFor(predicate: (state: GameRoomSnapshot) => boolean, label: string): Promise<GameRoomSnapshot>;
  nextActionResult(): Promise<ActionResultMessage>;
  nextRejection(): Promise<InputRejectedMessage>;
  request(type: "chooseTeam" | "startMatch", payload: Record<string, unknown>): Promise<ActionResultMessage>;
}

function joinOptions(displayName: string) {
  return { protocolVersion: PROTOCOL_VERSION, displayName };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), WAIT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * FIFO inbox so tests can await messages in the order the server sent them.
 * Callbacks only collect; malformed payloads surface as a rejection in the
 * awaiting test body rather than an assertion thrown inside an SDK callback.
 */
function inbox<T>(room: Room, type: string, parse: (value: unknown) => T | null) {
  type Entry = { parsed: T | null; raw: unknown };
  const queued: Entry[] = [];
  const waiters: Array<(entry: Entry) => void> = [];
  room.onMessage(type, (raw: unknown) => {
    const entry = { parsed: parse(raw), raw };
    const waiter = waiters.shift();
    if (waiter) waiter(entry);
    else queued.push(entry);
  });
  const unwrap = (entry: Entry): T => {
    if (entry.parsed === null) {
      throw new Error(`${type} payload is malformed: ${JSON.stringify(entry.raw)}`);
    }
    return entry.parsed;
  };
  return async (): Promise<T> => {
    const ready = queued.shift();
    if (ready !== undefined) return unwrap(ready);
    return unwrap(await withTimeout(new Promise<Entry>((resolve) => waiters.push(resolve)), type));
  };
}

let requestCounter = 0;

/**
 * The SDK resolves create/join before the first full state is decoded, so an
 * early `room.state.toJSON()` can lack `players`. Such snapshots are "not yet".
 */
function hasInitialState(state: Partial<GameRoomSnapshot> | undefined): state is GameRoomSnapshot {
  return typeof state?.players === "object" && state.players !== null;
}

function wrap(room: Room): Player {
  const nextActionResult = inbox(room, SERVER_MESSAGES.actionResult, parseActionResult);
  const nextRejection = inbox(room, SERVER_MESSAGES.inputRejected, parseInputRejected);
  const decoded = () => room.state?.toJSON() as Partial<GameRoomSnapshot> | undefined;
  const snapshot = (): GameRoomSnapshot => {
    const state = decoded();
    assert.ok(hasInitialState(state), "snapshot() requires the initial state; await waitFor first");
    return state;
  };
  return {
    room,
    id: room.sessionId,
    snapshot,
    nextActionResult,
    nextRejection,
    waitFor(predicate, label) {
      const current = decoded();
      if (hasInitialState(current) && predicate(current)) return Promise.resolve(current);
      return withTimeout(new Promise<GameRoomSnapshot>((resolve) => {
        const listener = () => {
          const state = decoded();
          if (hasInitialState(state) && predicate(state)) {
            room.onStateChange.remove(listener);
            resolve(state);
          }
        };
        room.onStateChange(listener);
      }), label);
    },
    async request(type, payload) {
      const requestId = `req-${++requestCounter}`;
      room.send(type, { requestId, ...payload });
      const result = await nextActionResult();
      assert.equal(result.requestId, requestId, "actionResult must be correlated with its request");
      return result;
    },
  };
}

async function startServer(t: TestContext, seed = TEST_SEED): Promise<Harness> {
  const { server, httpServer } = createGameServer({ mazeSeedSource: () => seed });
  const rooms: Room[] = [];
  t.after(async () => {
    await Promise.allSettled(rooms.map((room) => room.connection.isOpen ? room.leave() : undefined));
    await server.gracefullyShutdown(false);
  });
  await server.listen(0, "127.0.0.1");
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client(`ws://127.0.0.1:${address.port}`);
  const track = async (room: Room): Promise<Player> => {
    rooms.push(room);
    const player = wrap(room);
    await player.waitFor(() => true, "initial state");
    return player;
  };
  return {
    client,
    async create(displayName) {
      return track(await client.create(GAME_ROOM, joinOptions(displayName)));
    },
    async join(code, displayName) {
      return track(await client.joinById(code, joinOptions(displayName)));
    },
  };
}

async function rejectsWithCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(joinErrorCode(error), code, `expected ${code}, got ${String(error)}`);
    return true;
  });
}

function expectAccepted(result: ActionResultMessage): void {
  assert.equal(result.accepted, true, JSON.stringify(result));
}

function expectRejected(result: ActionResultMessage, code: ErrorCode): void {
  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(result.accepted === false && result.code, code);
}

function playerOf(state: GameRoomSnapshot, id: string): PlayerSnapshot {
  const player = state.players[id];
  assert.ok(player, `player ${id} must be in state`);
  return player;
}

/** Start a balanced 1v1 (host hunter, guest runner) and wait until both see `playing`. */
async function startOneVsOne(harness: Harness) {
  const host = await harness.create("Host");
  const guest = await harness.join(host.room.roomId, "Guest");
  expectAccepted(await host.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await guest.request("chooseTeam", { team: "runner" }));
  expectAccepted(await host.request("startMatch", {}));
  const state = await guest.waitFor((s) => s.phase === "playing", "playing phase");
  await host.waitFor((s) => s.phase === "playing", "playing phase on host");
  return { host, guest, state };
}

function walkableDirection(maze: readonly string[], player: PlayerSnapshot): Direction {
  const col = Math.floor(player.x);
  const row = Math.floor(player.y);
  const options: Array<[Direction, number, number]> = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];
  const found = options.find(([, dx, dy]) => isWalkableIn(maze, col + dx, row + dy));
  assert.ok(found, "spawn must have a walkable neighbor");
  return found[0];
}

test("AC1: A creates a private room and B joins by code; both see two players", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("  Alice ");
  const b = await harness.join(a.room.roomId, "Bob");
  for (const viewer of [a, b]) {
    const state = await viewer.waitFor((s) => Object.keys(s.players).length === 2, "two players");
    assert.equal(state.roomCode, a.room.roomId);
    assert.equal(state.hostPlayerId, a.id);
    assert.equal(state.phase, "lobby");
    assert.equal(state.protocolVersion, PROTOCOL_VERSION);
    assert.equal(playerOf(state, a.id).displayName, "Alice");
    assert.equal(playerOf(state, b.id).team, "unassigned");
    assert.equal(playerOf(state, b.id).id, b.id);
  }
  await assert.rejects(harness.client.join(GAME_ROOM, joinOptions("Matchmade")), "private rooms are not matchmade");
});

test("AC2: join failures reach the SDK with mappable codes", { timeout: 20_000 }, async (t) => {
  const harness = await startServer(t);
  await t.test("unknown code -> ROOM_NOT_FOUND", async () => {
    await rejectsWithCode(harness.client.joinById("noSuchRoom", joinOptions("Zed")), "ROOM_NOT_FOUND");
  });
  await t.test("bad or missing version -> PROTOCOL_MISMATCH on create and join", async () => {
    const host = await harness.create("Host");
    for (const options of [{ protocolVersion: PROTOCOL_VERSION + 1, displayName: "Old" }, { displayName: "None" }]) {
      await rejectsWithCode(harness.client.create(GAME_ROOM, options), "PROTOCOL_MISMATCH");
      await rejectsWithCode(harness.client.joinById(host.room.roomId, options), "PROTOCOL_MISMATCH");
    }
  });
  await t.test("bad display name or extra options -> INVALID_INPUT on create and join", async () => {
    const host = await harness.create("Host2");
    for (const displayName of ["", "   ", "x".repeat(17), "bad\u0007name"]) {
      await rejectsWithCode(harness.client.create(GAME_ROOM, joinOptions(displayName)), "INVALID_INPUT");
      await rejectsWithCode(harness.client.joinById(host.room.roomId, joinOptions(displayName)), "INVALID_INPUT");
    }
    await rejectsWithCode(
      harness.client.joinById(host.room.roomId, { ...joinOptions("Spoof"), sessionId: host.id }),
      "INVALID_INPUT",
    );
    assert.equal(Object.keys(host.snapshot().players).length, 1);
  });
  await t.test("fifth client -> ROOM_FULL", async () => {
    const host = await harness.create("P1");
    for (const name of ["P2", "P3", "P4"]) await harness.join(host.room.roomId, name);
    await rejectsWithCode(harness.client.joinById(host.room.roomId, joinOptions("P5")), "ROOM_FULL");
  });
  await t.test("join after start -> JOIN_CLOSED", async () => {
    const { host } = await startOneVsOne(harness);
    await rejectsWithCode(harness.client.joinById(host.room.roomId, joinOptions("Late")), "JOIN_CLOSED");
    assert.equal(Object.keys(host.snapshot().players).length, 2);
  });
});

test("AC3: chooseTeam enforces capacity and phase with correlated results", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await a.request("chooseTeam", { team: "hunter" })); // re-choosing is accepted
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectRejected(await c.request("chooseTeam", { team: "hunter" }), "TEAM_FULL");
  expectRejected(await c.request("chooseTeam", { team: "ghost" }), "INVALID_INPUT");
  c.room.send(CLIENT_MESSAGES.chooseTeam, { team: "runner" });
  assert.equal((await c.nextRejection()).code, "INVALID_INPUT", "uncorrelatable request -> inputRejected");
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  const lobby = await a.waitFor((s) => Object.values(s.players).filter((p) => p.team === "runner").length === 2, "teams");
  assert.equal(playerOf(lobby, c.id).team, "runner");
  expectAccepted(await a.request("startMatch", {}));
  await d.waitFor((s) => s.phase === "playing", "playing");
  expectRejected(await d.request("chooseTeam", { team: "hunter" }), "INVALID_PHASE");
  expectRejected(await a.request("chooseTeam", { team: "runner" }), "INVALID_PHASE");
});

test("AC4: startMatch requires host and balanced teams; 2v2 starts with distinct spawns", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectRejected(await b.request("startMatch", {}), "HOST_REQUIRED");
  expectRejected(await a.request("startMatch", {}), "TEAMS_UNBALANCED");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  expectRejected(await a.request("startMatch", {}), "TEAMS_UNBALANCED"); // D unassigned
  expectRejected(await a.request("startMatch", { phase: "playing" }), "INVALID_INPUT");
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  expectRejected(await b.request("startMatch", {}), "HOST_REQUIRED");
  expectAccepted(await a.request("startMatch", {}));
  const state = await c.waitFor((s) => s.phase === "playing", "playing");
  assert.ok(state.roundId.length > 0);
  assert.equal(state.mazeSeed, TEST_SEED);
  const maze = generateMaze(state.mazeSeed);
  const cells = Object.values(state.players).map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(cells).size, 4, "spawns must be distinct");
  for (const player of Object.values(state.players)) {
    assert.ok(isWalkableIn(maze, Math.floor(player.x), Math.floor(player.y)));
    assert.equal(player.lastInputSequence, -1);
  }
  expectRejected(await a.request("startMatch", {}), "INVALID_PHASE");
});

test("AC4: balanced 1v1 starts; unassigned player blocks start", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "TEAMS_UNBALANCED");
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "TEAMS_UNBALANCED");
  expectAccepted(await b.request("chooseTeam", { team: "runner" }));
  expectAccepted(await a.request("startMatch", {}));
  const state = await b.waitFor((s) => s.phase === "playing", "playing");
  assert.notEqual(`${playerOf(state, a.id).x},${playerOf(state, a.id).y}`, `${playerOf(state, b.id).x},${playerOf(state, b.id).y}`);
});

test("AC5: B observes A move after A's setDirection; positions stay walkable", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest, state } = await startOneVsOne(harness);
  const maze = generateMaze(state.mazeSeed);
  const spawn = playerOf(state, host.id);
  const direction = walkableDirection(maze, spawn);

  const offWalkable: string[] = [];
  guest.room.onStateChange(() => {
    for (const player of Object.values(guest.snapshot().players)) {
      if (!isWalkableIn(maze, Math.floor(player.x), Math.floor(player.y))) {
        offWalkable.push(`${player.id}@${player.x},${player.y}`);
      }
    }
  });

  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction });
  const moved = await guest.waitFor((s) => {
    const a = playerOf(s, host.id);
    return Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y) >= 1;
  }, "A moved at least one tile");
  assert.equal(playerOf(moved, host.id).lastInputSequence, 1);
  const stillGuest = playerOf(moved, guest.id);
  const guestSpawn = playerOf(state, guest.id);
  assert.deepEqual([stillGuest.x, stillGuest.y], [guestSpawn.x, guestSpawn.y], "B did not move without input");
  assert.deepEqual(offWalkable, []);
});

test("AC6: malformed, spoofed, stale, duplicate, out-of-phase, and excessive input", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const lobbyHost = await harness.create("Lobby");
  lobbyHost.room.send(CLIENT_MESSAGES.setDirection, { roundId: "none", sequence: 1, direction: "up" });
  assert.equal((await lobbyHost.nextRejection()).code, "INVALID_PHASE", "lobby input -> INVALID_PHASE");

  const { host, state } = await startOneVsOne(harness);
  const roundId = state.roundId;
  const before = playerOf(state, host.id);
  const maze = generateMaze(state.mazeSeed);
  const openDirection = walkableDirection(maze, before);

  const malformed: unknown[] = [
    { roundId, sequence: 1, direction: openDirection, x: 3, y: 3 },
    { roundId, sequence: 1, direction: openDirection, speed: 99 },
    { roundId, sequence: 1, direction: "north" },
    { roundId, sequence: -1, direction: openDirection },
    { roundId, sequence: 1.5, direction: openDirection },
    "up",
    42,
    null,
  ];
  for (const payload of malformed) {
    host.room.send(CLIENT_MESSAGES.setDirection, payload);
    assert.equal((await host.nextRejection()).code, "INVALID_INPUT", JSON.stringify(payload));
  }
  host.room.send("teleport", { x: 1, y: 1 });
  assert.equal((await host.nextRejection()).code, "INVALID_INPUT", "unknown message type");

  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: "old-round", sequence: 1, direction: openDirection });
  assert.equal((await host.nextRejection()).code, "STALE_ROUND");

  // Facing direction is a no-op turn into a wall; then a duplicate/old sequence
  // requesting an open direction must be ignored silently.
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId, sequence: 5, direction: before.direction });
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId, sequence: 5, direction: openDirection });
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId, sequence: 4, direction: openDirection });
  host.room.send(CLIENT_MESSAGES.setDirection, { sentinel: true });
  assert.equal((await host.nextRejection()).code, "INVALID_INPUT", "duplicates produce no rejection");

  const revisionAfterInputs = host.snapshot().revision;
  const settled = await host.waitFor((s) => s.revision >= revisionAfterInputs + 6, "several ticks");
  const after = playerOf(settled, host.id);
  assert.equal(after.lastInputSequence, 5);
  assert.deepEqual([after.x, after.y, after.direction], [before.x, before.y, before.direction], "no state change");
  assert.ok(host.room.connection.isOpen, "rejections keep the client connected");

  const lastBurstSequence = 10 + INPUT_RATE_LIMIT_MAX_MESSAGES + 5;
  for (let sequence = 10; sequence <= lastBurstSequence; sequence++) {
    host.room.send(CLIENT_MESSAGES.setDirection, { roundId, sequence, direction: before.direction });
  }
  host.room.send(CLIENT_MESSAGES.setDirection, { sentinel: true });
  assert.equal((await host.nextRejection()).code, "RATE_LIMITED");
  assert.equal((await host.nextRejection()).code, "INVALID_INPUT", "only one RATE_LIMITED notice per window");
  const burstRevision = host.snapshot().revision;
  const afterBurst = await host.waitFor((s) => s.revision >= burstRevision + 3, "ticks after burst");
  assert.ok(playerOf(afterBurst, host.id).lastInputSequence < lastBurstSequence, "excess inputs are dropped");
});

test("message flood beyond the hard cap disconnects only the abusive client", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const observer = await harness.create("Observer");
  const flooder = await harness.join(observer.room.roomId, "Flooder");
  await observer.waitFor((s) => flooder.id in s.players, "flooder joined");
  const closed = withTimeout(new Promise<number>((resolve) => flooder.room.onLeave((code) => resolve(code))), "flooder drop");
  for (let i = 0; i <= MAX_CLIENT_MESSAGES_PER_SECOND + 20; i++) {
    flooder.room.send(CLIENT_MESSAGES.setDirection, {});
  }
  assert.equal(await closed, 4002, "Colyseus closes the flooding client with WITH_ERROR");
  const state = await observer.waitFor((s) => !(flooder.id in s.players), "flooder removed");
  assert.equal(state.hostPlayerId, observer.id);
  assert.ok(observer.room.connection.isOpen, "other clients stay connected");
});

test("AC7: host transfers to the earliest remaining player; empty room is disposed", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const code = a.room.roomId;
  await a.room.leave();
  const transferred = await c.waitFor((s) => !(a.id in s.players), "A removed");
  assert.equal(transferred.hostPlayerId, b.id);
  await b.room.leave();
  assert.equal((await c.waitFor((s) => !(b.id in s.players), "B removed")).hostPlayerId, c.id);
  assert.equal((await matchMaker.query({ roomId: code })).length, 1, "room exists while occupied");
  await c.room.leave();
  const deadline = Date.now() + WAIT_MS;
  let remaining = 1;
  while (Date.now() < deadline) {
    remaining = (await matchMaker.query({ roomId: code })).length;
    if (remaining === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(remaining, 0, "server disposed the empty room");
  await rejectsWithCode(harness.client.joinById(code, joinOptions("Late")), "ROOM_NOT_FOUND");
});
