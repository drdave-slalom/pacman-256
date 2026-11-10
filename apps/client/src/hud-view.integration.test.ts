import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Client, type Room } from "@colyseus/sdk";
import {
  GAME_ROOM,
  GAME_RULES,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  findSpawnCells,
  parseActionResult,
  parseInputRejected,
  type ActionResultMessage,
  type GameRoomSnapshot,
  type InputRejectedMessage,
} from "@maze/shared";
import { createGameServer } from "../../server/src/server.ts";
import type { SpawnPlacer } from "../../server/src/game-room.ts";
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

const WAIT_MS = 3_000;
const TEST_SEED = 424_242;
/** Fake epoch start for the injectable server clock. */
const T0 = 1_000_000;

interface Harness {
  client: Client;
  create(displayName: string): Promise<Player>;
  join(code: string, displayName: string): Promise<Player>;
  now(): number;
  advance(ms: number): void;
}

interface Player {
  room: Room;
  id: string;
  snapshot(): GameRoomSnapshot;
  waitFor(predicate: (state: GameRoomSnapshot) => boolean, label: string): Promise<GameRoomSnapshot>;
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

function hasInitialState(state: Partial<GameRoomSnapshot> | undefined): state is GameRoomSnapshot {
  return typeof state?.players === "object" && state.players !== null;
}

function wrap(room: Room): Player {
  const nextActionResult = inbox(room, SERVER_MESSAGES.actionResult, parseActionResult);
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
      const requestId = `t6-req-${++requestCounter}`;
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

/** Lobby 1v1 (host hunter, guest runner) with startMatch accepted; both see `countdown`. */
async function countdownOneVsOne(harness: Harness) {
  const host = await harness.create("Host");
  const guest = await harness.join(host.room.roomId, "Guest");
  const hostTeam = await host.request("chooseTeam", { team: "hunter" });
  const guestTeam = await guest.request("chooseTeam", { team: "runner" });
  assert.equal(hostTeam.accepted, true, JSON.stringify(hostTeam));
  assert.equal(guestTeam.accepted, true, JSON.stringify(guestTeam));
  const started = await host.request("startMatch", {});
  assert.equal(started.accepted, true, JSON.stringify(started));
  const countdown = await guest.waitFor((s) => s.phase === "countdown", "countdown phase");
  await host.waitFor((s) => s.phase === "countdown", "countdown phase on host");
  return { host, guest, countdown };
}

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

test("T6 integration: countdown and playing HUD strings from authoritative server snapshots", { timeout: 20_000 }, async (t) => {
  const harness = await startServer(t);
  const { host, guest, countdown } = await countdownOneVsOne(harness);

  // Countdown: maze phase, 3→… seconds from server fields, no steering.
  assert.equal(isMazePhase(countdown), true);
  assert.equal(countdownRemaining(countdown), 3);
  assert.deepEqual(aliveCounts(countdown), { hunter: 1, runner: 1 });
  assert.equal(canSteer(countdown, host.id), false, "no input accepted during countdown");
  assert.equal(canSteer(countdown, guest.id), false);
  assert.equal(isLocalEliminated(countdown, host.id), false);
  assert.equal(resultView(countdown), null, "no result before results");

  // Advance the injected clock past the countdown; both clients reach playing.
  harness.advance(GAME_RULES.countdownMs);
  const playing = await guest.waitFor((s) => s.phase === "playing", "playing phase");
  await host.waitFor((s) => s.phase === "playing", "playing phase on host");

  // Playing HUD: round timer m:ss from roundEndsAt − serverTime, alive counts, steerable.
  assert.equal(isMazePhase(playing), true);
  assert.ok(roundTimeRemaining(playing) > 0, "round time is positive");
  assert.ok(roundTimeRemaining(playing) <= GAME_RULES.roundDurationMs, "round time never exceeds the deadline");
  assert.equal(formatClock(roundTimeRemaining(playing)), "3:00");
  assert.deepEqual(aliveCounts(playing), { hunter: 1, runner: 1 });
  assert.equal(canSteer(playing, host.id), true);
  assert.equal(canSteer(playing, guest.id), true);
  assert.equal(isLocalEliminated(playing, guest.id), false);
  assert.equal(resultView(playing), null, "no winner text while playing");
});

test("T6 integration: contact elimination reaches results with exactly the server line", { timeout: 20_000 }, async (t) => {
  const harness = await startServer(t, TEST_SEED, firstRunnerOnHunterSpawn());
  const { host, guest } = await countdownOneVsOne(harness);
  harness.advance(GAME_RULES.countdownMs);
  const results = await guest.waitFor((s) => s.phase === "results", "results");

  const view = resultView(results);
  assert.ok(view, "results phase yields a result view");
  assert.equal(results.resultWinner, "hunter");
  assert.equal(results.resultReason, "teamEliminated");
  assert.equal(view.winner, "Hunters win");
  assert.equal(view.reason, "all runners eliminated");
  assert.equal(view.line, "Round over: Hunters win: all runners eliminated.");

  assert.equal(isMazePhase(results), true, "maze and players keep rendering in results");
  assert.equal(isLocalEliminated(results, guest.id), true, "eliminated guest is spectating");
  assert.equal(canSteer(results, host.id), false, "results freeze movement");
  assert.deepEqual(aliveCounts(results), { hunter: 1, runner: 0 });
});

test("T6 integration: deadline timeout reaches results with runner/timeout text", { timeout: 20_000 }, async (t) => {
  const harness = await startServer(t);
  const { guest } = await countdownOneVsOne(harness);
  harness.advance(GAME_RULES.countdownMs);
  const playing = await guest.waitFor((s) => s.phase === "playing", "playing");
  assert.equal(resultView(playing), null);

  harness.advance(GAME_RULES.roundDurationMs);
  const results = await guest.waitFor((s) => s.phase === "results", "timeout results");
  const view = resultView(results);
  assert.ok(view);
  assert.equal(results.resultWinner, "runner");
  assert.equal(results.resultReason, "timeout");
  assert.equal(view.line, "Round over: Runners win: survived to the deadline.");
});
