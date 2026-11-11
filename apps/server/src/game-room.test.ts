import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  CLIENT_MESSAGES,
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  GAME_ROOM,
  GAME_RULES,
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  MAZE_HEIGHT,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  evaluateRoundOutcome,
  findSpawnCells,
  generateMaze,
  isWalkableIn,
  joinErrorCode,
  spawnDirection,
  parseActionResult,
  parseInputRejected,
  type ActionResultMessage,
  type Direction,
  type ErrorCode,
  type GameRoomSnapshot,
  type InputRejectedMessage,
  type PlayerSnapshot,
} from "@maze/shared";
import { GameRoom, SIMULATION_STEP_MS, planSimulationSteps, resolveContacts, type SpawnPlacer, type StepMove } from "./game-room.ts";
import { createGameServer } from "./server.ts";

const WAIT_MS = 3_000;
const TEST_SEED = 424_242;
/** Fake epoch start for the injectable server clock. */
const T0 = 1_000_000;

interface Harness {
  client: Client;
  /** Create or join, track the room for cleanup, and resolve once the initial state is decoded. */
  create(displayName: string): Promise<Player>;
  join(code: string, displayName: string): Promise<Player>;
  /** Current fake server time (ms). */
  now(): number;
  /** Advance the fake server clock; phases react on the next tick. */
  advance(ms: number): void;
}

interface Player {
  room: Room;
  id: string;
  snapshot(): GameRoomSnapshot;
  waitFor(predicate: (state: GameRoomSnapshot) => boolean, label: string): Promise<GameRoomSnapshot>;
  nextActionResult(): Promise<ActionResultMessage>;
  nextRejection(): Promise<InputRejectedMessage>;
  request(type: "chooseTeam" | "startMatch" | "returnToLobby", payload: Record<string, unknown>): Promise<ActionResultMessage>;
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

async function startServer(t: TestContext, seed = TEST_SEED, spawnPlacer?: SpawnPlacer): Promise<Harness> {
  let fakeNow = T0;
  const { server, httpServer } = createGameServer({
    mazeSeedSource: () => seed,
    clock: () => fakeNow,
    ...(spawnPlacer ? { spawnPlacer } : {}),
  });
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
    now: () => fakeNow,
    advance(ms) { fakeNow += ms; },
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

/** Start a balanced 1v1 (host hunter, guest runner), skip the countdown, and wait until both see `playing`. */
async function startOneVsOne(harness: Harness) {
  const host = await harness.create("Host");
  const guest = await harness.join(host.room.roomId, "Guest");
  expectAccepted(await host.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await guest.request("chooseTeam", { team: "runner" }));
  expectAccepted(await host.request("startMatch", {}));
  await guest.waitFor((s) => s.phase === "countdown", "countdown phase");
  harness.advance(GAME_RULES.countdownMs);
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

test("AC3: chooseTeam enforces phase with correlated results; no team cap", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await a.request("chooseTeam", { team: "hunter" })); // re-choosing is accepted
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await c.request("chooseTeam", { team: "hunter" })); // third hunter allowed (no TEAM_FULL)
  expectRejected(await c.request("chooseTeam", { team: "ghost" }), "INVALID_INPUT");
  c.room.send(CLIENT_MESSAGES.chooseTeam, { team: "runner" });
  assert.equal((await c.nextRejection()).code, "INVALID_INPUT", "uncorrelatable request -> inputRejected");
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  const lobby = await a.waitFor((s) => Object.values(s.players).filter((p) => p.team === "runner").length === 2, "teams");
  assert.equal(playerOf(lobby, c.id).team, "runner");
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
  await d.waitFor((s) => s.phase === "playing", "playing");
  expectRejected(await d.request("chooseTeam", { team: "hunter" }), "INVALID_PHASE");
  expectRejected(await a.request("chooseTeam", { team: "runner" }), "INVALID_PHASE");
});

test("AC4: startMatch requires host and every player assigned; 2v1 starts", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  expectRejected(await b.request("startMatch", {}), "HOST_REQUIRED");
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT"); // nobody picked yet
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT"); // empty runner side
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT"); // empty runner side
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  expectRejected(await b.request("startMatch", {}), "HOST_REQUIRED");
  // 2v1 with all players assigned starts: no equal-count requirement.
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
  const state = await c.waitFor((s) => s.phase === "playing", "playing");
  const hunters = Object.values(state.players).filter((p) => p.team === "hunter");
  const runners = Object.values(state.players).filter((p) => p.team === "runner");
  assert.equal(hunters.length, 2);
  assert.equal(runners.length, 1);
  const maze = generateMaze(state.mazeSeed);
  const cells = [...hunters, ...runners].map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(cells).size, 3, "assigned spawns must be distinct");
  for (const player of [...hunters, ...runners]) {
    assert.ok(isWalkableIn(maze, Math.floor(player.x), Math.floor(player.y)));
    assert.equal(player.lastInputSequence, -1);
  }
  expectRejected(await a.request("startMatch", {}), "INVALID_PHASE");
});

test("AC4: start with an unassigned player present is rejected", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  // D never picked: start must be rejected and the lobby phase preserved.
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT");
  assert.equal(a.snapshot().phase, "lobby");
  // Once D picks, the same all-assigned roster starts.
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
  const state = await c.waitFor((s) => s.phase === "playing", "playing");
  const hunters = Object.values(state.players).filter((p) => p.team === "hunter");
  const runners = Object.values(state.players).filter((p) => p.team === "runner");
  assert.equal(hunters.length, 2);
  assert.equal(runners.length, 2);
});

test("AC4: balanced 2v2 starts with distinct spawns", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await c.request("chooseTeam", { team: "runner" }));
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  expectRejected(await b.request("startMatch", {}), "HOST_REQUIRED");
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
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

test("AC4: balanced 1v1 starts; empty side is rejected", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT");
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectRejected(await a.request("startMatch", {}), "INVALID_INPUT");
  expectAccepted(await b.request("chooseTeam", { team: "runner" }));
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
  const state = await b.waitFor((s) => s.phase === "playing", "playing");
  assert.notEqual(`${playerOf(state, a.id).x},${playerOf(state, a.id).y}`, `${playerOf(state, b.id).x},${playerOf(state, b.id).y}`);
});

test("AC4: 3v1 starts and assigns three hunter spawns", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const a = await harness.create("A");
  const b = await harness.join(a.room.roomId, "B");
  const c = await harness.join(a.room.roomId, "C");
  const d = await harness.join(a.room.roomId, "D");
  expectAccepted(await a.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await b.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await c.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await d.request("chooseTeam", { team: "runner" }));
  expectAccepted(await a.request("startMatch", {}));
  harness.advance(GAME_RULES.countdownMs);
  const state = await d.waitFor((s) => s.phase === "playing", "playing");
  const hunters = Object.values(state.players).filter((p) => p.team === "hunter");
  const runners = Object.values(state.players).filter((p) => p.team === "runner");
  assert.equal(hunters.length, 3);
  assert.equal(runners.length, 1);
  const maze = generateMaze(state.mazeSeed);
  const cells = [...hunters, ...runners].map((p) => `${p.x},${p.y}`);
  assert.equal(new Set(cells).size, 4, "spawns must be distinct");
  for (const player of [...hunters, ...runners]) {
    assert.ok(isWalkableIn(maze, Math.floor(player.x), Math.floor(player.y)));
    assert.equal(player.lastInputSequence, -1);
  }
  const midRow = Math.floor(MAZE_HEIGHT / 2);
  for (const hunter of hunters) assert.ok(Math.floor(hunter.y) < midRow, "hunters spawn in the top half");
  for (const runner of runners) assert.ok(Math.floor(runner.y) > midRow, "runners spawn in the bottom half");
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
  await guest.waitFor((s) => playerOf(s, host.id).lastInputSequence === 1, "A's input accepted");
  // Movement follows server simulation time: advance the fake clock past one tile (4 tiles/s).
  harness.advance(500);
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

/** Lobby 1v1 (host hunter, guest runner) with startMatch accepted; both see `countdown`. */
async function countdownOneVsOne(harness: Harness) {
  const host = await harness.create("Host");
  const guest = await harness.join(host.room.roomId, "Guest");
  expectAccepted(await host.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await guest.request("chooseTeam", { team: "runner" }));
  const startedAt = harness.now();
  expectAccepted(await host.request("startMatch", {}));
  const state = await guest.waitFor((s) => s.phase === "countdown", "countdown phase");
  await host.waitFor((s) => s.phase === "countdown", "countdown phase on host");
  return { host, guest, state, startedAt };
}

function expectNoRoundFields(state: GameRoomSnapshot): void {
  assert.equal(state.roundId, "");
  assert.equal(state.countdownEndsAt, 0);
  assert.equal(state.roundEndsAt, 0);
  assert.equal(state.resultWinner, "");
  assert.equal(state.resultReason, "");
  assert.equal(state.resultEndedAt, 0);
}

test("T5: startMatch enters countdown with no movement or input, then playing", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, state, startedAt } = await countdownOneVsOne(harness);
  assert.equal(state.countdownEndsAt, startedAt + GAME_RULES.countdownMs);
  assert.equal(state.roundEndsAt, 0);
  assert.equal(state.resultWinner, "");
  assert.ok(state.roundId.length > 0);
  const maze = generateMaze(state.mazeSeed);
  const spawn = playerOf(state, host.id);
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: walkableDirection(maze, spawn) });
  assert.equal((await host.nextRejection()).code, "INVALID_PHASE", "countdown input -> INVALID_PHASE");
  const revision = host.snapshot().revision;
  const later = await host.waitFor((s) => s.revision >= revision + 5, "ticks during countdown");
  assert.equal(later.phase, "countdown");
  assert.deepEqual(Object.values(later.players).map((p) => [p.x, p.y]), Object.values(state.players).map((p) => [p.x, p.y]));

  harness.advance(GAME_RULES.countdownMs - 1);
  const stillCounting = host.snapshot().revision;
  assert.equal((await host.waitFor((s) => s.revision >= stillCounting + 2, "ticks")).phase, "countdown");
  harness.advance(1);
  const playing = await host.waitFor((s) => s.phase === "playing", "playing");
  assert.equal(playing.countdownEndsAt, 0);
  assert.equal(playing.roundEndsAt, state.countdownEndsAt + GAME_RULES.roundDurationMs);
  assert.equal(playing.roundId, state.roundId);
});

test("T5: leaving a 1v1 countdown empties a side and cancels to lobby (D054)", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest } = await countdownOneVsOne(harness);
  await guest.room.leave();
  const lobby = await host.waitFor((s) => s.phase === "lobby" && !(guest.id in s.players), "cancelled to lobby");
  expectNoRoundFields(lobby);
  assert.equal(playerOf(lobby, host.id).team, "hunter", "teams are kept");
});

/** Lobby 2v2 (join order H1, R1, H2, R2) with startMatch accepted; R1 sees `countdown`. */
async function countdownTwoVsTwo(harness: Harness) {
  const h1 = await harness.create("H1");
  const r1 = await harness.join(h1.room.roomId, "R1");
  const h2 = await harness.join(h1.room.roomId, "H2");
  const r2 = await harness.join(h1.room.roomId, "R2");
  expectAccepted(await h1.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await r1.request("chooseTeam", { team: "runner" }));
  expectAccepted(await h2.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await r2.request("chooseTeam", { team: "runner" }));
  expectAccepted(await h1.request("startMatch", {}));
  const countdown = await r1.waitFor((s) => s.phase === "countdown", "countdown");
  return { h1, r1, h2, r2, countdown };
}

test("T5: host leaving a 2v2 countdown continues as 2v1 (D054); host transfers, round kept", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { h1, r1, h2, r2, countdown } = await countdownTwoVsTwo(harness);
  assert.ok(countdown.roundId.length > 0);
  await h1.room.leave();
  const after = await r1.waitFor((s) => !(h1.id in s.players), "host removed");
  assert.equal(after.phase, "countdown", "2v1 is still startable, so the countdown continues");
  assert.equal(after.roundId, countdown.roundId);
  assert.equal(after.mazeSeed, countdown.mazeSeed);
  assert.equal(after.countdownEndsAt, countdown.countdownEndsAt);
  assert.equal(after.hostPlayerId, r1.id, "host transfers to the earliest remaining player");
  assert.equal(Object.keys(after.players).length, 3);
  assert.equal(playerOf(after, r1.id).team, "runner");
  assert.equal(playerOf(after, h2.id).team, "hunter");
  assert.equal(playerOf(after, r2.id).team, "runner");
  harness.advance(GAME_RULES.countdownMs);
  const playing = await r1.waitFor((s) => s.phase === "playing", "2v1 round plays");
  assert.equal(playing.roundId, countdown.roundId);
});

test("T5: the only runner leaving a 2v1 countdown empties a side and cancels to lobby (D054)", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const h1 = await harness.create("H1");
  const r1 = await harness.join(h1.room.roomId, "R1");
  const h2 = await harness.join(h1.room.roomId, "H2");
  expectAccepted(await h1.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await r1.request("chooseTeam", { team: "runner" }));
  expectAccepted(await h2.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await h1.request("startMatch", {}));
  await h2.waitFor((s) => s.phase === "countdown", "countdown");
  await r1.room.leave();
  const lobby = await h1.waitFor((s) => s.phase === "lobby" && !(r1.id in s.players), "cancelled to lobby");
  expectNoRoundFields(lobby);
  assert.equal(lobby.mazeSeed, 0);
  assert.equal(lobby.hostPlayerId, h1.id);
  assert.equal(playerOf(lobby, h1.id).team, "hunter", "teams are kept");
  assert.equal(playerOf(lobby, h2.id).team, "hunter", "teams are kept");
  for (const player of Object.values(lobby.players)) assert.equal(player.alive, true);
});

test("T5: deadline ends the round as runner/timeout; returnToLobby resets for a new round", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest, state } = await startOneVsOne(harness);
  expectRejected(await host.request("returnToLobby", {}), "INVALID_PHASE");
  harness.advance(GAME_RULES.roundDurationMs - 1);
  const revision = host.snapshot().revision;
  assert.equal((await host.waitFor((s) => s.revision >= revision + 2, "ticks")).phase, "playing");
  harness.advance(1);
  const results = await guest.waitFor((s) => s.phase === "results", "results");
  assert.equal(results.resultWinner, "runner");
  assert.equal(results.resultReason, "timeout");
  assert.equal(results.resultEndedAt, state.roundEndsAt);
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: "up" });
  assert.equal((await host.nextRejection()).code, "INVALID_PHASE", "results input -> INVALID_PHASE");

  expectRejected(await guest.request("returnToLobby", {}), "HOST_REQUIRED");
  expectRejected(await host.request("returnToLobby", { extra: 1 }), "INVALID_INPUT");
  expectAccepted(await host.request("returnToLobby", {}));
  const lobby = await guest.waitFor((s) => s.phase === "lobby", "lobby");
  expectNoRoundFields(lobby);
  assert.equal(playerOf(lobby, host.id).team, "hunter");
  assert.equal(playerOf(lobby, guest.id).team, "runner");
  for (const player of Object.values(lobby.players)) {
    assert.equal(player.alive, true);
    assert.equal(player.queuedDirection, "");
  }
  expectRejected(await host.request("returnToLobby", {}), "INVALID_PHASE");

  expectAccepted(await host.request("startMatch", {}));
  const next = await guest.waitFor((s) => s.phase === "countdown", "second countdown");
  assert.notEqual(next.roundId, state.roundId);
  harness.advance(GAME_RULES.countdownMs);
  await host.waitFor((s) => s.phase === "playing", "second round playing");
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: "up" });
  assert.equal((await host.nextRejection()).code, "STALE_ROUND");
});

function move(id: string, team: "hunter" | "runner", from: [number, number], to: [number, number] = from): StepMove {
  return { id, team, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } };
}

test("T5 unit: resolveContacts batches hunter x runner contacts order-independently", () => {
  // Stationary overlap.
  assert.deepEqual([...resolveContacts([move("h", "hunter", [1.5, 1.5]), move("r", "runner", [1.5, 1.5])])], ["r"]);
  // Head-on swap within one step: endpoints are far apart, the swept path crosses.
  assert.deepEqual(
    [...resolveContacts([move("h", "hunter", [1.5, 1.5], [3.5, 1.5]), move("r", "runner", [3.5, 1.5], [1.5, 1.5])])],
    ["r"],
  );
  // Same-team overlaps are ignored.
  assert.equal(resolveContacts([move("h1", "hunter", [1.5, 1.5]), move("h2", "hunter", [1.5, 1.5])]).size, 0);
  assert.equal(resolveContacts([move("r1", "runner", [1.5, 1.5]), move("r2", "runner", [1.5, 1.5])]).size, 0);
  // Out of range.
  assert.equal(resolveContacts([move("h", "hunter", [1.5, 1.5]), move("r", "runner", [3.5, 1.5])]).size, 0);
  // Two runners hit in one batch, independent of input order.
  const moves = [
    move("r1", "runner", [1.5, 1.5]),
    move("h1", "hunter", [1.5, 1.5]),
    move("r2", "runner", [5.5, 5.5]),
    move("h2", "hunter", [5.5, 5.5]),
  ];
  assert.deepEqual([...resolveContacts(moves)].sort(), ["r1", "r2"]);
  assert.deepEqual([...resolveContacts([...moves].reverse())].sort(), ["r1", "r2"]);
});

test("T5 unit: same-step elimination + last-hunter disconnect is a simultaneous wipe", () => {
  // 2v2 after earlier losses: H1 already left; H2 and R2 remain (R1 eliminated earlier).
  // This step: the last runner (R2) is caught while the last hunter (H2) is eliminated in the same
  // step (reachable with T7 vulnerability); the outcome is evaluated from step-start counts.
  const eliminated = resolveContacts([move("h2", "hunter", [2.5, 2.5]), move("r2", "runner", [2.5, 2.5])]);
  assert.deepEqual([...eliminated], ["r2"]);
  assert.deepEqual(
    evaluateRoundOutcome({ huntersAlive: 0, runnersAlive: 0, huntersAliveBefore: 1, runnersAliveBefore: 1, deadlineReached: false }),
    { winner: "none", reason: "simultaneousWipe" },
  );
  // A contact on the deadline step resolves before the timeout.
  assert.deepEqual(
    evaluateRoundOutcome({ huntersAlive: 1, runnersAlive: 0, huntersAliveBefore: 1, runnersAliveBefore: 1, deadlineReached: true }),
    { winner: "hunter", reason: "teamEliminated" },
  );
});

/** Place the first runner on the first hunter spawn so they overlap at round start. */
function firstRunnerOnHunterSpawn(): SpawnPlacer {
  let runnersPlaced = 0;
  return (team, position, maze) => {
    if (team !== "runner" || runnersPlaced++ > 0) return position;
    const cell = findSpawnCells(maze).hunter[0];
    assert.ok(cell);
    return { x: cell.col + 0.5, y: cell.row + 0.5 };
  };
}

test("T5: hunter contact eliminates a runner in 2v2; eliminated runner stays, frozen, and input is INVALID_PHASE", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t, TEST_SEED, firstRunnerOnHunterSpawn());
  const h1 = await harness.create("H1");
  const r1 = await harness.join(h1.room.roomId, "R1");
  const h2 = await harness.join(h1.room.roomId, "H2");
  const r2 = await harness.join(h1.room.roomId, "R2");
  expectAccepted(await h1.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await r1.request("chooseTeam", { team: "runner" }));
  expectAccepted(await h2.request("chooseTeam", { team: "hunter" }));
  expectAccepted(await r2.request("chooseTeam", { team: "runner" }));
  expectAccepted(await h1.request("startMatch", {}));
  const countdown = await r1.waitFor((s) => s.phase === "countdown", "countdown");
  assert.equal(playerOf(countdown, r1.id).alive, true, "no contact during countdown");
  harness.advance(GAME_RULES.countdownMs);
  const hit = await r1.waitFor((s) => s.players[r1.id]?.alive === false, "R1 eliminated");
  assert.equal(hit.phase, "playing", "one runner left: round continues");
  assert.equal(playerOf(hit, r2.id).alive, true);
  const frozen = playerOf(hit, r1.id);
  r1.room.send(CLIENT_MESSAGES.setDirection, { roundId: hit.roundId, sequence: 1, direction: "up" });
  assert.equal((await r1.nextRejection()).code, "INVALID_PHASE", "eliminated input -> INVALID_PHASE");
  const revision = r1.snapshot().revision;
  const later = await r1.waitFor((s) => s.revision >= revision + 3, "ticks");
  assert.deepEqual([playerOf(later, r1.id).x, playerOf(later, r1.id).y], [frozen.x, frozen.y], "eliminated players don't move");

  // The last runner disconnecting ends the round; the eliminated runner is still listed.
  await r2.room.leave();
  const results = await h1.waitFor((s) => s.phase === "results", "results");
  assert.equal(results.resultWinner, "hunter");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(results.resultEndedAt, harness.now());
  assert.equal(playerOf(results, r1.id).alive, false);
});

test("T5: everyone alive leaving at once ends the round for a remaining spectator (none/abandoned when same tick)", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t, TEST_SEED, firstRunnerOnHunterSpawn());
  const { h1, r1, h2, r2 } = await countdownTwoVsTwo(harness);
  harness.advance(GAME_RULES.countdownMs);
  const hit = await r1.waitFor((s) => s.players[r1.id]?.alive === false, "R1 eliminated");
  assert.equal(hit.phase, "playing");
  // Sent concurrently: the three closes usually land between two ticks (→ none/abandoned),
  // but socket close timing can split them across ticks (~1 in 25 locally), in which case
  // one team empties first (→ teamEliminated). Abandoned itself is pinned in round.test.ts.
  await Promise.all([h1.room.leave(), h2.room.leave(), r2.room.leave()]);
  const results = await r1.waitFor((s) => s.phase === "results", "results");
  const outcome = `${results.resultWinner}/${results.resultReason}`;
  assert.ok(
    ["none/abandoned", "runner/teamEliminated", "hunter/teamEliminated"].includes(outcome),
    `unexpected outcome ${outcome}`,
  );
  assert.deepEqual(Object.keys(results.players), [r1.id]);
  assert.equal(results.hostPlayerId, r1.id);
});

test("T5: 1v1 contact at round start ends as hunter/teamEliminated", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t, TEST_SEED, firstRunnerOnHunterSpawn());
  const { host, guest } = await countdownOneVsOne(harness);
  harness.advance(GAME_RULES.countdownMs);
  const results = await host.waitFor((s) => s.phase === "results", "results");
  assert.equal(results.resultWinner, "hunter");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(results.resultEndedAt, harness.now());
  assert.equal(playerOf(results, guest.id).alive, false, "eliminated runner stays in players");
});

test("T5: last runner disconnecting during playing -> hunter/teamEliminated", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest } = await startOneVsOne(harness);
  await guest.room.leave();
  const results = await host.waitFor((s) => s.phase === "results", "results");
  assert.equal(results.resultWinner, "hunter");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(results.hostPlayerId, host.id);
  assert.ok(!(guest.id in results.players));
});

test("T5: last hunter (host) disconnecting during playing -> runner/teamEliminated; host transfers", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest } = await startOneVsOne(harness);
  await host.room.leave();
  const results = await guest.waitFor((s) => s.phase === "results", "results");
  assert.equal(results.resultWinner, "runner");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(results.hostPlayerId, guest.id);
  expectAccepted(await guest.request("returnToLobby", {}));
});

test("T5 unit: planSimulationSteps catches up in full steps, carries leftovers, and never passes the deadline", () => {
  const step = SIMULATION_STEP_MS;
  const deadline = GAME_RULES.roundDurationMs;
  const durations = (cursor: number, ends: number[]) => ends.map((end, i) => end - (i === 0 ? cursor : ends[i - 1]!));
  // On-time callback: exactly one step.
  assert.equal(planSimulationSteps(0, step, deadline).length, 1);
  // Early callback (less than a step): nothing due; the leftover carries over.
  assert.deepEqual(planSimulationSteps(0, step - 1, deadline), []);
  // Delayed callback before the deadline: 200 ms -> 6 full steps, no partial step.
  const delayed = planSimulationSteps(0, 200, deadline);
  assert.equal(delayed.length, 6);
  for (const d of durations(0, delayed)) assert.ok(Math.abs(d - step) < 1e-6);
  // Offset callback: 50 ms from cursor 10 -> one step; the 16.7 ms remainder carries to the next tick.
  const offset = planSimulationSteps(10, 60, deadline);
  assert.equal(offset.length, 1);
  assert.deepEqual(planSimulationSteps(offset[0]!, 70, deadline), [], "16.7 ms + 10 ms is still below a step");
  assert.equal(planSimulationSteps(offset[0]!, 77, deadline).length, 1, "carried remainder completes a step");
  // Jump past the deadline from 100 ms before: exactly 3 full steps, no zero-length partial.
  const exact = planSimulationSteps(deadline - 100, deadline + 5_000, deadline);
  assert.equal(exact.length, 3);
  assert.equal(exact.at(-1), deadline);
  // Jump past the deadline from 110 ms before: 3 full steps + a 10 ms partial, totalling exactly 110 ms.
  const cursor = deadline - 110;
  const across = planSimulationSteps(cursor, deadline + 5_000, deadline);
  const parts = durations(cursor, across);
  assert.equal(across.length, 4);
  assert.ok(Math.abs(parts.at(-1)! - 10) < 1e-6, `partial step ${parts.at(-1)}`);
  assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - 110) < 1e-6);
  assert.equal(across.at(-1), deadline);
  for (const end of across) assert.ok(end <= deadline, "no step goes beyond the deadline");
  // A whole round from the start in one jump: 5400 steps ending exactly at the deadline, no drift.
  const whole = planSimulationSteps(0, deadline + 1, deadline);
  assert.equal(whole.length, deadline / step);
  assert.equal(whole.at(-1), deadline);
  // Cursor already at the deadline: nothing more to simulate.
  assert.deepEqual(planSimulationSteps(deadline, deadline + 1_000, deadline), []);
});

test("T5: a delayed tick before the deadline simulates all elapsed time, not one capped step", { timeout: 15_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, state } = await startOneVsOne(harness);
  const start = playerOf(state, host.id);
  const maze = generateMaze(state.mazeSeed);
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: walkableDirection(maze, start) });
  await host.waitFor((s) => playerOf(s, host.id).lastInputSequence === 1, "input accepted");
  // One delayed callback covering 200 ms (6 steps); 0.8 tiles never reaches a wall from a cell center.
  harness.advance(200);
  const moved = await host.waitFor((s) => {
    const p = s.players[host.id];
    return p !== undefined && (p.x !== start.x || p.y !== start.y);
  }, "hunter moved");
  const end = playerOf(moved, host.id);
  const distance = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  const expected = DEFAULT_MOVE_SPEED_TILES_PER_SECOND * 0.2;
  const oneStep = DEFAULT_MOVE_SPEED_TILES_PER_SECOND * SIMULATION_STEP_MS / 1000;
  assert.ok(Math.abs(distance - expected) <= oneStep, `moved ${distance} tiles, expected ~${expected}`);
});

type Cell = { col: number; row: number };
const DELTAS: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * Adjacent walkable cells A (hunter) and B (runner) where each player's spawn direction is
 * immediately blocked, so both stay at their cell centers, exactly 1 tile apart, until steered.
 */
function adjacentPair(maze: readonly string[]): { a: Cell; b: Cell; toward: Direction; back: Direction } {
  const spawns = findSpawnCells(maze);
  const dirH = spawnDirection(maze, spawns.hunter[0]!);
  const dirR = spawnDirection(maze, spawns.runner[0]!);
  const blocked = (cell: Cell, dir: Direction) => !isWalkableIn(maze, cell.col + DELTAS[dir][0], cell.row + DELTAS[dir][1]);
  const opposite: Record<Direction, Direction> = { up: "down", down: "up", left: "right", right: "left" };
  for (let row = 1; row < maze.length - 1; row++) {
    for (let col = 1; col < maze[row]!.length - 1; col++) {
      const a = { col, row };
      if (!isWalkableIn(maze, col, row) || !blocked(a, dirH)) continue;
      for (const toward of ["up", "down", "left", "right"] as const) {
        const b = { col: col + DELTAS[toward][0], row: row + DELTAS[toward][1] };
        if (isWalkableIn(maze, b.col, b.row) && blocked(b, dirR)) {
          return { a, b, toward, back: opposite[toward] };
        }
      }
    }
  }
  assert.fail("no adjacent blocked pair in the test maze");
}

test("T5: a delayed tick across the deadline still resolves a catch in the final 100 ms before timing out", { timeout: 15_000 }, async (t) => {
  let pair: ReturnType<typeof adjacentPair> | undefined;
  const placer: SpawnPlacer = (team, _position, maze) => {
    pair ??= adjacentPair(maze);
    const cell = team === "hunter" ? pair.a : pair.b;
    return { x: cell.col + 0.5, y: cell.row + 0.5 };
  };
  const harness = await startServer(t, TEST_SEED, placer);
  const { host, guest, state } = await startOneVsOne(harness);
  assert.ok(pair);
  // Cursor lands exactly 100 ms before the deadline (5397 full steps); nobody has moved.
  harness.advance(GAME_RULES.roundDurationMs - 100);
  const revision = host.snapshot().revision;
  const before = await host.waitFor((s) => s.revision >= revision + 2, "ticks");
  assert.equal(before.phase, "playing", JSON.stringify(before));
  assert.deepEqual([playerOf(before, host.id).x, playerOf(before, host.id).y], [pair.a.col + 0.5, pair.a.row + 0.5]);
  assert.deepEqual([playerOf(before, guest.id).x, playerOf(before, guest.id).y], [pair.b.col + 0.5, pair.b.row + 0.5]);
  // Steer them together: 1.0 tile apart closing at 8 tiles/s reaches contact (0.6) after 50 ms —
  // more than one capped 33 ms step, well within the remaining 100 ms.
  host.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: pair.toward });
  guest.room.send(CLIENT_MESSAGES.setDirection, { roundId: state.roundId, sequence: 1, direction: pair.back });
  await host.waitFor(
    (s) => s.players[host.id]?.queuedDirection === pair!.toward && s.players[guest.id]?.queuedDirection === pair!.back,
    "both turns queued",
  );
  harness.advance(1_000);
  const results = await host.waitFor((s) => s.phase === "results", "results");
  assert.equal(`${results.resultWinner}/${results.resultReason}`, "hunter/teamEliminated");
  assert.ok(results.resultEndedAt < results.roundEndsAt, "decided before the deadline");
  assert.ok(results.resultEndedAt > results.roundEndsAt - 100);
  assert.equal(playerOf(results, guest.id).alive, false);
});

test("T7 real room: protected contact blocks without crossing and permits retreat", async t => {
  const harness = await startServer(t);
  const { host, guest } = await startOneVsOne(harness);
  const room = authoritativeRoom(host.room.roomId);
  const hunter = room.state.players.get(host.id)!;
  const runner = room.state.players.get(guest.id)!;
  const cell = corridor(generateMaze(TEST_SEED));
  hunter.x = cell.col + 0.5; hunter.y = cell.row + 0.5; hunter.direction = "right";
  runner.x = cell.col + 1.5; runner.y = cell.row + 0.5; runner.direction = "left";
  runner.shieldEndsAt = harness.now() + 3000;
  harness.advance(500);
  const blocked = await host.waitFor(s => s.simulationTime >= harness.now() - 1e-6, "blocked movement");
  assert.equal(blocked.phase, "playing");
  const h = blocked.players[host.id]!, r = blocked.players[guest.id]!;
  assert.ok(Math.abs(r.x - h.x - 0.6) < 1e-6, "stopped at the contact boundary");
  hunter.direction = "left"; runner.direction = "right";
  harness.advance(100);
  const separated = await guest.waitFor(s => s.simulationTime >= harness.now() - 1e-6, "retreat");
  assert.ok(separated.players[guest.id]!.x - separated.players[host.id]!.x > 0.6);
});

test("T7 real room: vulnerability respawns exactly at 18s, independent of hunter shields", async t => {
  const harness = await startServer(t);
  const { host, guest } = await startOneVsOne(harness);
  const room = authoritativeRoom(host.room.roomId);
  const runner = room.state.players.get(guest.id)!;
  const pickup = room.state.pickups.get("vulnerability")!;
  pickup.col = Math.floor(runner.x); pickup.row = Math.floor(runner.y);
  const collected = await guest.waitFor(s => s.vulnerabilityEndsAt > 0, "global collection");
  const at = collected.simulationTime;
  room.state.players.get(host.id)!.shieldEndsAt = at + 30000;
  harness.advance(8000);
  const expired = await guest.waitFor(s => s.simulationTime >= at + 8000 - 1e-6, "8s expiry");
  assert.equal(expired.pickups.vulnerability!.active, false);
  assert.equal(expired.vulnerabilityRespawnAt, at + 18000);
  harness.advance(10000);
  const spawned = await guest.waitFor(s => s.simulationTime >= at + 18000 - 1e-6 && !!s.pickups.vulnerability?.active, "18s respawn");
  assert.ok(spawned.players[host.id]!.shieldEndsAt > spawned.simulationTime);
  assert.equal(spawned.vulnerabilityRespawnAt, at + 18000);
});

test("T7 real room: hunter shield exact deadline expiry reverses contact before timeout", async t => {
  const harness = await startServer(t);
  const { host, guest, state } = await startOneVsOne(harness);
  harness.advance(GAME_RULES.roundDurationMs - 100);
  await host.waitFor(s => s.simulationTime >= state.roundEndsAt - 100 - 1e-6, "last 100ms");
  const room = authoritativeRoom(host.room.roomId);
  const hunter = room.state.players.get(host.id)!;
  const runner = room.state.players.get(guest.id)!;
  runner.x = hunter.x; runner.y = hunter.y; runner.direction = hunter.direction;
  runner.shieldEndsAt = state.roundEndsAt + 3000;
  hunter.shieldEndsAt = state.roundEndsAt;
  room.state.vulnerabilityEndsAt = state.roundEndsAt + 8000;
  harness.advance(1000);
  const result = await guest.waitFor(s => s.phase === "results", "deadline reversal");
  assert.equal(result.resultWinner, "runner");
  assert.equal(result.resultReason, "teamEliminated", "combat wins over timeout");
  assert.equal(result.resultEndedAt, state.roundEndsAt);
  assert.equal(result.simulationTime, state.roundEndsAt);
  assert.equal(result.players[host.id]!.alive, false);
});

/** Trusted test setup only: clients have no path to mutate these schema fields. */
function authoritativeRoom(code: string): GameRoom {
  const room = matchMaker.getLocalRoomById(code);
  assert.ok(room instanceof GameRoom);
  return room;
}

function corridor(maze: readonly string[]): { col: number; row: number } {
  for (let row = 1; row < maze.length - 1; row++) {
    for (let col = 1; col < maze[row]!.length - 3; col++) {
      if ([0, 1, 2].every(dx => isWalkableIn(maze, col + dx, row))) return { col, row };
    }
  }
  throw new Error("test seed needs a straight corridor");
}

test("T7 real room: initial pickups, spoof rejection, speed/shield collection and exact respawn; replay clears effects", async t => {
  const harness = await startServer(t);
  const { host, guest, state } = await startOneVsOne(harness);
  assert.equal(Object.keys(state.pickups).length, 3);
  const cells = new Set<string>();
  for (const pickup of Object.values(state.pickups)) {
    assert.equal(pickup.active, true);
    assert.ok(isWalkableIn(generateMaze(TEST_SEED), pickup.col, pickup.row));
    assert.ok(!Object.values(state.players).some(p => Math.floor(p.x) === pickup.col && Math.floor(p.y) === pickup.row));
    cells.add(`${pickup.col},${pickup.row}`);
  }
  assert.equal(cells.size, 3);
  host.room.send("pickup", { kind: "speed", speedEndsAt: 999999999 });
  assert.equal((await host.nextRejection()).code, "INVALID_INPUT");
  const room = authoritativeRoom(host.room.roomId);
  const hunter = room.state.players.get(host.id)!;
  const runner = room.state.players.get(guest.id)!;
  for (const kind of ["speed", "shield"] as const) {
    const pickup = room.state.pickups.get(kind)!;
    pickup.col = Math.floor(hunter.x); pickup.row = Math.floor(hunter.y); pickup.active = true;
  }
  const collected = await host.waitFor(s => (s.players[host.id]?.speedEndsAt ?? 0) > 0 && (s.players[host.id]?.shieldEndsAt ?? 0) > 0, "both effects");
  const collectedAt = collected.simulationTime;
  assert.equal(collected.players[host.id]!.speedEndsAt, collectedAt + 5000);
  assert.equal(collected.players[host.id]!.shieldEndsAt, collectedAt + 3000);
  harness.advance(3000);
  const expired = await host.waitFor(s => s.simulationTime >= collectedAt + 3000, "exact shield expiry");
  assert.equal(expired.players[host.id]!.shieldEndsAt, 0);
  assert.ok(expired.players[host.id]!.speedEndsAt > expired.simulationTime);
  harness.advance(12000);
  const respawn = await host.waitFor(s => s.simulationTime >= collectedAt + 15000, "15s respawn");
  // Respawn occurs at the beginning of a simulation step, including a zero step on the next tick.
  const spawned = await host.waitFor(s => !!s.pickups.speed?.active && !!s.pickups.shield?.active, "standard respawns");
  assert.ok(spawned.simulationTime >= respawn.simulationTime);
  assert.equal(spawned.players[host.id]!.speedEndsAt, 0);
  runner.x = hunter.x; runner.y = hunter.y;
  await host.waitFor(s => s.phase === "results", "contact ends round");
  expectAccepted(await host.request("returnToLobby", {}));
  const lobby = await guest.waitFor(s => s.phase === "lobby", "reset");
  assert.deepEqual(lobby.pickups, {});
  assert.equal(lobby.vulnerabilityEndsAt, 0);
  for (const player of Object.values(lobby.players)) {
    assert.equal(player.speedEndsAt, 0); assert.equal(player.shieldEndsAt, 0); assert.equal(player.alive, true);
  }
});

test("T7 real room: runner-only global pickup, 0/8/18 schedule and shield expiry exposes hunter", async t => {
  const harness = await startServer(t);
  const { host, guest, state } = await startOneVsOne(harness);
  const room = authoritativeRoom(host.room.roomId);
  const hunter = room.state.players.get(host.id)!;
  const runner = room.state.players.get(guest.id)!;
  const pickup = room.state.pickups.get("vulnerability")!;
  pickup.col = Math.floor(hunter.x); pickup.row = Math.floor(hunter.y);
  const revision = host.snapshot().revision;
  await host.waitFor(s => s.revision > revision + 1, "hunter cannot claim");
  assert.equal(pickup.active, true);
  pickup.col = Math.floor(runner.x); pickup.row = Math.floor(runner.y);
  const collected = await host.waitFor(s => s.vulnerabilityEndsAt > 0, "runner global pickup");
  const at = collected.simulationTime;
  assert.equal(collected.vulnerabilityEndsAt, at + 8000);
  assert.equal(collected.vulnerabilityRespawnAt, at + 18000);
  hunter.shieldEndsAt = at + 3000;
  // Runner shield prevents normal combat while hunter shield overrides global reversal.
  runner.shieldEndsAt = at + 5000;
  runner.x = hunter.x; runner.y = hunter.y;
  harness.advance(2999);
  await host.waitFor(s => s.serverTime >= at + 2999, "shield still protects");
  assert.equal(room.state.phase, "playing");
  harness.advance(1);
  const results = await guest.waitFor(s => s.phase === "results", "hunter shield expires");
  assert.equal(results.resultWinner, "runner");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(results.players[host.id]!.alive, false);
  assert.ok(results.vulnerabilityEndsAt > results.resultEndedAt);
  assert.equal(results.pickups.vulnerability!.active, false);
  harness.advance(20000);
  const finalRevision = results.revision;
  const final = await host.waitFor(s => s.revision > finalRevision + 1, "results stay frozen");
  assert.equal(final.pickups.vulnerability!.active, false);
  assert.equal(final.simulationTime, results.simulationTime);
});

test("T7 real room: pickup-before-contact global reversal and speed traversal", async t => {
  const harness = await startServer(t);
  const { host, guest } = await startOneVsOne(harness);
  const room = authoritativeRoom(host.room.roomId);
  const hunter = room.state.players.get(host.id)!;
  const runner = room.state.players.get(guest.id)!;
  const cell = corridor(generateMaze(TEST_SEED));
  runner.x = cell.col + 0.5; runner.y = cell.row + 0.5; runner.direction = "right";
  runner.speedEndsAt = harness.now() + 5000;
  const startX = runner.x;
  harness.advance(100);
  const moved = await guest.waitFor(s => s.simulationTime >= harness.now() - 1e-6, "speed movement");
  assert.ok(Math.abs(moved.players[guest.id]!.x - startX - 0.6) < 1e-6);
  // Put an unshielded hunter and the reversal pickup at the runner's current position.
  hunter.x = runner.x; hunter.y = runner.y;
  const pickup = room.state.pickups.get("vulnerability")!;
  // Set up center contact in a zero-duration simulation tick.
  runner.x = cell.col + 1.5; hunter.x = runner.x;
  pickup.col = cell.col + 1; pickup.row = cell.row;
  const results = await guest.waitFor(s => s.phase === "results", "post-pickup contact");
  assert.equal(results.resultWinner, "runner");
  assert.equal(results.players[host.id]!.alive, false);
  assert.equal(results.players[guest.id]!.alive, true);
});

test("T7 unit: mixed contacts eliminate together, independent of iteration and runner shields", () => {
  const moves = [
    { ...move("h1", "hunter", [1.5, 1.5]), shieldEndsAt: 100 },
    move("r1", "runner", [1.5, 1.5]),
    move("h2", "hunter", [5.5, 5.5]),
    { ...move("r2", "runner", [5.5, 5.5]), shieldEndsAt: 100 },
  ];
  assert.deepEqual([...resolveContacts(moves, 50, 100)].sort(), ["h2", "r1"]);
  assert.deepEqual([...resolveContacts([...moves].reverse(), 50, 100)].sort(), ["h2", "r1"]);
});
