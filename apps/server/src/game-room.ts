import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Room, ServerError, type Client } from "@colyseus/core";
import { schema, t } from "@colyseus/schema";
import {
  CLIENT_MESSAGES,
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  GAME_RULES,
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  INPUT_RATE_LIMIT_WINDOW_MS,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  PATCH_INTERVAL_MS,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  SIMULATION_HZ,
  errorMessage,
  evaluateRoundOutcome,
  findSpawnCells,
  generateMaze,
  isProtocolCompatible,
  joinErrorText,
  parseChooseTeam,
  parseJoinOptions,
  parseReturnToLobby,
  parseSetDirection,
  parseStartMatch,
  readRequestId,
  spawnDirection,
  stepPlayerMove,
  sweptContact,
  type ActionResultMessage,
  type Direction,
  type ErrorCode,
  type InputRejectedMessage,
  type PlayerTeam,
  type QueuedDirection,
  type ResultReason,
  type ResultWinner,
  type RoomPhase,
  type Team,
  type Vec2,
} from "@maze/shared";

const PlayerState = schema({
  id: t.string().default(""),
  displayName: t.string().default(""),
  team: t.string<PlayerTeam>().default("unassigned"),
  alive: t.boolean().default(true),
  x: t.number().default(0),
  y: t.number().default(0),
  direction: t.string<Direction>().default("left"),
  queuedDirection: t.string<QueuedDirection>().default(""),
  lastInputSequence: t.number().default(-1),
});
type PlayerState = InstanceType<typeof PlayerState>;

const GameState = schema({
  protocolVersion: t.number().default(PROTOCOL_VERSION),
  roomCode: t.string().default(""),
  hostPlayerId: t.string().default(""),
  phase: t.string<RoomPhase>().default("lobby"),
  revision: t.number().default(0),
  serverTime: t.number().default(0),
  roundId: t.string().default(""),
  mazeSeed: t.uint32().default(0),
  countdownEndsAt: t.number().default(0),
  roundEndsAt: t.number().default(0),
  resultWinner: t.string<ResultWinner | "">().default(""),
  resultReason: t.string<ResultReason | "">().default(""),
  resultEndedAt: t.number().default(0),
  players: t.map(PlayerState),
});
type GameState = InstanceType<typeof GameState>;

/** Produces the server-chosen maze seed for each round (uint32). */
export type MazeSeedSource = () => number;

const UINT32_RANGE = 0x1_0000_0000;

/** Wall-clock source in epoch milliseconds; injectable for tests. */
export type Clock = () => number;

/**
 * Trusted test hook: choose a player's spawn position given the default one.
 * Production rooms always use the default.
 */
export type SpawnPlacer = (team: Team, defaultPosition: Vec2, maze: readonly string[]) => Vec2;

/** One alive player's movement over a single simulation step. */
export interface StepMove {
  id: string;
  team: Team;
  from: Vec2;
  to: Vec2;
}

/**
 * Pure contact batch for one step: every hunter × runner pair is checked with
 * `sweptContact` against the same snapshot, so the result does not depend on
 * iteration order. Same-team pairs are never checked. Returns the IDs of the
 * runners to eliminate (each at most once).
 */
export function resolveContacts(moves: readonly StepMove[]): Set<string> {
  const hunters = moves.filter((move) => move.team === "hunter");
  const eliminated = new Set<string>();
  for (const runner of moves) {
    if (runner.team !== "runner") {
      continue;
    }
    if (hunters.some((hunter) => sweptContact(hunter.from, hunter.to, runner.from, runner.to))) {
      eliminated.add(runner.id);
    }
  }
  return eliminated;
}

/** One full simulation step in ms (1000 / SIMULATION_HZ). */
export const SIMULATION_STEP_MS = 1000 / SIMULATION_HZ;
/** Tolerance for float drift when comparing step boundaries (ms; inputs are round-relative). */
const STEP_EPSILON_MS = 1e-6;

/**
 * Plan the simulation steps that catch the cursor up to `min(targetMs, deadlineMs)`.
 * Returns each step's end time (same time base as the inputs; use round-relative ms so
 * the epsilon dominates rounding). Full steps run while they fit; leftover time below a
 * full step carries over, except at the deadline, which gets one final partial step so
 * movement and contact are processed up to the deadline and never beyond it.
 */
export function planSimulationSteps(
  cursorMs: number,
  targetMs: number,
  deadlineMs: number,
  stepMs: number = SIMULATION_STEP_MS,
): number[] {
  const limit = Math.min(targetMs, deadlineMs);
  const ends: number[] = [];
  let at = cursorMs;
  while (at + stepMs <= limit + STEP_EPSILON_MS) {
    at += stepMs;
    if (at >= deadlineMs - STEP_EPSILON_MS) {
      at = deadlineMs;
    }
    ends.push(at);
  }
  if (targetMs >= deadlineMs && at < deadlineMs) {
    ends.push(deadlineMs);
  }
  return ends;
}

export function randomMazeSeed(): number {
  return randomInt(0, UINT32_RANGE);
}

function joinError(code: ErrorCode): ServerError {
  return new ServerError(400, joinErrorText(code));
}

/** Start rejection when a side has no players (D054). */
const NEEDS_ONE_PER_TEAM_MESSAGE = "Both teams need at least one player (a hunter and a runner) to start.";
/** Start rejection when someone has not picked a team (D054). */
const ALL_PLAYERS_MUST_PICK_MESSAGE = "Every player must pick a team before starting.";

/**
 * Private T3 game room: lobby team selection, host start, and authoritative
 * 30 Hz movement. T5 adds countdown, hunter/runner contact elimination,
 * round outcomes (elimination, disconnect, timeout), and return-to-lobby.
 */
export class GameRoom extends Room<{ state: GameState }> {
  maxClients = GAME_RULES.maxPlayers;

  /** Overridden only by trusted server code (tests); never by client options. */
  protected nextMazeSeed: MazeSeedSource = randomMazeSeed;
  /** Overridden only by trusted server code (tests) to control phase deadlines. */
  protected now: Clock = Date.now;
  /** Overridden only by trusted server code (tests) to place spawns deterministically. */
  protected placeSpawn: SpawnPlacer = (_team, position) => position;

  #maze: readonly string[] | null = null;
  readonly #joinOrder: string[] = [];
  readonly #recentInputs = new Map<string, number[]>();
  /** Last time each client was told RATE_LIMITED (one notice per window). */
  readonly #rateLimitNoticeAt = new Map<string, number>();
  /** Epoch ms at which `playing` began (the countdown deadline). */
  #roundStartedAt = 0;
  /** Simulation cursor: round-relative ms already simulated; never passes the round deadline. */
  #simulatedMs = 0;

  async onCreate(options: unknown): Promise<void> {
    const code = this.#joinOptionsError(options);
    if (code) {
      throw joinError(code);
    }
    this.setState(new GameState({ roomCode: this.roomId, serverTime: this.now() }));
    this.patchRate = PATCH_INTERVAL_MS;
    this.maxMessagesPerSecond = MAX_CLIENT_MESSAGES_PER_SECOND;
    await this.setPrivate(true);

    this.onMessage(CLIENT_MESSAGES.chooseTeam, (client, payload: unknown) => this.#chooseTeam(client, payload));
    this.onMessage(CLIENT_MESSAGES.startMatch, (client, payload: unknown) => this.#startMatch(client, payload));
    this.onMessage(CLIENT_MESSAGES.returnToLobby, (client, payload: unknown) => this.#returnToLobby(client, payload));
    this.onMessage(CLIENT_MESSAGES.setDirection, (client, payload: unknown) => this.#setDirection(client, payload));
    this.onMessage("*", (client) => this.#rejectInput(client, "INVALID_INPUT"));
    this.setFixedTimestep(() => this.#tick(), SIMULATION_HZ);
  }

  onAuth(_client: Client, options: unknown): true {
    const code = this.#joinOptionsError(options) ?? (this.state.phase === "lobby" ? null : "JOIN_CLOSED");
    if (code) {
      throw joinError(code);
    }
    return true;
  }

  onJoin(client: Client, options: unknown): void {
    // Re-check defensively rather than relying on onAuth ordering.
    if (this.state.phase !== "lobby") {
      throw joinError("JOIN_CLOSED");
    }
    const parsed = parseJoinOptions(options);
    if (!parsed) {
      throw joinError("INVALID_INPUT");
    }
    this.state.players.set(client.sessionId, new PlayerState({ id: client.sessionId, displayName: parsed.displayName }));
    this.#joinOrder.push(client.sessionId);
    if (!this.state.hostPlayerId) {
      this.state.hostPlayerId = client.sessionId;
    }
    this.#changed();
  }

  onLeave(client: Client): void {
    const { sessionId } = client;
    this.state.players.delete(sessionId);
    this.#recentInputs.delete(sessionId);
    this.#rateLimitNoticeAt.delete(sessionId);
    const index = this.#joinOrder.indexOf(sessionId);
    if (index >= 0) {
      this.#joinOrder.splice(index, 1);
    }
    if (this.state.hostPlayerId === sessionId) {
      this.state.hostPlayerId = this.#joinOrder[0] ?? "";
    }
    // D054 start-eligibility: joins are closed during countdown, so everyone is
    // assigned; cancel only when a side has become empty.
    if (this.state.phase === "countdown" && !this.#bothSidesOccupied()) {
      this.#resetToLobby();
    }
    this.#changed();
  }

  #joinOptionsError(options: unknown): ErrorCode | null {
    const version = typeof options === "object" && options !== null && "protocolVersion" in options
      ? options.protocolVersion
      : undefined;
    if (!isProtocolCompatible(version)) {
      return "PROTOCOL_MISMATCH";
    }
    return parseJoinOptions(options) ? null : "INVALID_INPUT";
  }

  #changed(): void {
    this.state.revision += 1;
    this.state.serverTime = this.now();
  }

  #respond(client: Client, requestId: string, code: ErrorCode | null, message?: string): void {
    const result: ActionResultMessage = code
      ? { requestId, accepted: false, code, message: message ?? errorMessage(code) }
      : { requestId, accepted: true };
    client.send(SERVER_MESSAGES.actionResult, result);
  }

  #rejectInput(client: Client, code: ErrorCode): void {
    const rejection: InputRejectedMessage = { code, message: errorMessage(code) };
    client.send(SERVER_MESSAGES.inputRejected, rejection);
  }

  /** Malformed request: answer with a correlated actionResult when the ID is recoverable. */
  #rejectMalformedRequest(client: Client, payload: unknown): void {
    const requestId = readRequestId(payload);
    if (requestId) {
      this.#respond(client, requestId, "INVALID_INPUT");
    } else {
      this.#rejectInput(client, "INVALID_INPUT");
    }
  }

  #chooseTeam(client: Client, payload: unknown): void {
    const request = parseChooseTeam(payload);
    if (!request) {
      this.#rejectMalformedRequest(client, payload);
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player || this.state.phase !== "lobby") {
      this.#respond(client, request.requestId, "INVALID_PHASE");
      return;
    }
    if (player.team !== request.team) {
      player.team = request.team;
      this.#changed();
    }
    this.#respond(client, request.requestId, null);
  }

  #startMatch(client: Client, payload: unknown): void {
    const request = parseStartMatch(payload);
    if (!request) {
      this.#rejectMalformedRequest(client, payload);
      return;
    }
    if (client.sessionId !== this.state.hostPlayerId) {
      this.#respond(client, request.requestId, "HOST_REQUIRED");
      return;
    }
    if (this.state.phase !== "lobby") {
      this.#respond(client, request.requestId, "INVALID_PHASE");
      return;
    }
    const hunters = this.#teamCount("hunter");
    const runners = this.#teamCount("runner");
    const unassigned = this.state.players.size - hunters - runners;
    if (hunters < 1 || runners < 1) {
      this.#respond(client, request.requestId, "INVALID_INPUT", NEEDS_ONE_PER_TEAM_MESSAGE);
      return;
    }
    if (unassigned > 0) {
      this.#respond(client, request.requestId, "INVALID_INPUT", ALL_PLAYERS_MUST_PICK_MESSAGE);
      return;
    }

    const seed = this.nextMazeSeed() >>> 0;
    const maze = generateMaze(seed);
    const spawns = findSpawnCells(maze);
    const nextSpawnIndex = { hunter: 0, runner: 0 };
    for (const sessionId of this.#joinOrder) {
      const player = this.state.players.get(sessionId);
      if (!player || player.team === "unassigned") {
        continue;
      }
      const cell = spawns[player.team][nextSpawnIndex[player.team]++];
      assert(cell, "teams never exceed the available spawn cells");
      const position = this.placeSpawn(player.team, { x: cell.col + 0.5, y: cell.row + 0.5 }, maze);
      player.alive = true;
      player.x = position.x;
      player.y = position.y;
      player.direction = spawnDirection(maze, cell);
      player.queuedDirection = "";
      player.lastInputSequence = -1;
    }
    this.#maze = maze;
    this.#recentInputs.clear();
    this.#rateLimitNoticeAt.clear();
    this.state.mazeSeed = seed;
    this.state.roundId = randomUUID();
    this.state.phase = "countdown";
    this.state.countdownEndsAt = this.now() + GAME_RULES.countdownMs;
    this.state.roundEndsAt = 0;
    this.state.resultWinner = "";
    this.state.resultReason = "";
    this.state.resultEndedAt = 0;
    this.#changed();
    this.#respond(client, request.requestId, null);
  }

  #returnToLobby(client: Client, payload: unknown): void {
    const request = parseReturnToLobby(payload);
    if (!request) {
      this.#rejectMalformedRequest(client, payload);
      return;
    }
    if (client.sessionId !== this.state.hostPlayerId) {
      this.#respond(client, request.requestId, "HOST_REQUIRED");
      return;
    }
    if (this.state.phase !== "results") {
      this.#respond(client, request.requestId, "INVALID_PHASE");
      return;
    }
    this.#resetToLobby();
    this.#changed();
    this.#respond(client, request.requestId, null);
  }

  /** Back to lobby with teams kept; clears every round and result field. */
  #resetToLobby(): void {
    this.state.players.forEach((player: PlayerState) => {
      player.alive = true;
      player.queuedDirection = "";
    });
    this.#maze = null;
    this.state.phase = "lobby";
    this.state.roundId = "";
    this.state.mazeSeed = 0;
    this.state.countdownEndsAt = 0;
    this.state.roundEndsAt = 0;
    this.state.resultWinner = "";
    this.state.resultReason = "";
    this.state.resultEndedAt = 0;
  }

  /** D054: a round needs at least one hunter and one runner; team sizes may differ. */
  #bothSidesOccupied(): boolean {
    return this.#teamCount("hunter") >= 1 && this.#teamCount("runner") >= 1;
  }

  #setDirection(client: Client, payload: unknown): void {
    const input = parseSetDirection(payload);
    if (!input) {
      this.#rejectInput(client, "INVALID_INPUT");
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive || this.state.phase !== "playing") {
      this.#rejectInput(client, "INVALID_PHASE");
      return;
    }
    if (input.roundId !== this.state.roundId) {
      this.#rejectInput(client, "STALE_ROUND");
      return;
    }
    if (input.sequence <= player.lastInputSequence) {
      return; // Already processed; discard silently (contract §2).
    }
    if (this.#isRateLimited(client.sessionId)) {
      this.#noticeRateLimited(client);
      return; // Excess input is always dropped.
    }
    player.queuedDirection = input.direction;
    player.lastInputSequence = input.sequence;
    this.#changed();
  }

  #isRateLimited(sessionId: string): boolean {
    const now = performance.now();
    const recent = (this.#recentInputs.get(sessionId) ?? []).filter(
      (time) => now - time < INPUT_RATE_LIMIT_WINDOW_MS,
    );
    const limited = recent.length >= INPUT_RATE_LIMIT_MAX_MESSAGES;
    if (!limited) {
      recent.push(now);
    }
    this.#recentInputs.set(sessionId, recent);
    return limited;
  }

  /** Send RATE_LIMITED at most once per rate-limit window per client. */
  #noticeRateLimited(client: Client): void {
    const now = performance.now();
    const last = this.#rateLimitNoticeAt.get(client.sessionId);
    if (last !== undefined && now - last < INPUT_RATE_LIMIT_WINDOW_MS) {
      return;
    }
    this.#rateLimitNoticeAt.set(client.sessionId, now);
    this.#rejectInput(client, "RATE_LIMITED");
  }

  #teamCount(team: PlayerTeam): number {
    let count = 0;
    this.state.players.forEach((player: PlayerState) => {
      if (player.team === team) {
        count += 1;
      }
    });
    return count;
  }

  #aliveCounts(): { hunter: number; runner: number } {
    const counts = { hunter: 0, runner: 0 };
    this.state.players.forEach((player: PlayerState) => {
      if (player.alive && player.team !== "unassigned") {
        counts[player.team] += 1;
      }
    });
    return counts;
  }

  #tick(): void {
    const now = this.now();
    if (this.state.phase === "countdown" && now >= this.state.countdownEndsAt) {
      this.state.phase = "playing";
      this.state.roundEndsAt = this.state.countdownEndsAt + GAME_RULES.roundDurationMs;
      this.#roundStartedAt = this.state.countdownEndsAt;
      this.#simulatedMs = 0;
      this.state.countdownEndsAt = 0;
    }
    const maze = this.#maze;
    if (this.state.phase === "playing" && maze) {
      this.#catchUp(now, maze);
    }
    this.#changed();
  }

  /**
   * Advance the simulation cursor toward `min(now, roundEndsAt)` in fixed steps (plus a final
   * partial step at the deadline), stopping as soon as the round ends. With nothing due, one
   * zero-length step still runs so disconnects since the last tick are evaluated promptly.
   */
  #catchUp(now: number, maze: readonly string[]): void {
    const deadlineMs = this.state.roundEndsAt - this.#roundStartedAt;
    const ends = planSimulationSteps(this.#simulatedMs, now - this.#roundStartedAt, deadlineMs);
    if (ends.length === 0) {
      ends.push(this.#simulatedMs);
    }
    for (const end of ends) {
      const dt = Math.max(0, (end - this.#simulatedMs) / 1000);
      this.#simulatedMs = end;
      this.#playingStep(dt, end >= deadlineMs, this.#roundStartedAt + end, maze);
      if (this.state.phase !== "playing") {
        return;
      }
    }
  }

  /** One D041 step: move → contacts on one snapshot → eliminate together → outcome. */
  #playingStep(dt: number, deadlineReached: boolean, stepEndsAt: number, maze: readonly string[]): void {
    // Alive counts at step start (the first step of a tick sees any disconnects since the last tick).
    const before = this.#aliveCounts();
    const moves: StepMove[] = [];
    this.state.players.forEach((player: PlayerState) => {
      if (!player.alive || player.team === "unassigned") {
        return;
      }
      const from = { x: player.x, y: player.y };
      if (dt > 0) {
        const next = stepPlayerMove(
          {
            position: from,
            direction: player.direction,
            queuedDirection: player.queuedDirection === "" ? null : player.queuedDirection,
          },
          DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
          dt,
          maze,
        );
        player.x = next.position.x;
        player.y = next.position.y;
        player.direction = next.direction;
        player.queuedDirection = next.queuedDirection ?? "";
      }
      moves.push({ id: player.id, team: player.team, from, to: { x: player.x, y: player.y } });
    });
    for (const id of resolveContacts(moves)) {
      const player = this.state.players.get(id);
      if (player) {
        player.alive = false;
        player.queuedDirection = "";
      }
    }
    const after = this.#aliveCounts();
    const outcome = evaluateRoundOutcome({
      huntersAlive: after.hunter,
      runnersAlive: after.runner,
      huntersAliveBefore: before.hunter,
      runnersAliveBefore: before.runner,
      deadlineReached,
    });
    if (outcome) {
      this.state.phase = "results";
      this.state.resultWinner = outcome.winner;
      this.state.resultReason = outcome.reason;
      this.state.resultEndedAt = Math.min(stepEndsAt, this.state.roundEndsAt);
    }
  }
}

export interface GameRoomOverrides {
  seedSource?: MazeSeedSource | undefined;
  clock?: Clock | undefined;
  spawnPlacer?: SpawnPlacer | undefined;
}

/** A GameRoom with trusted server-side seed and/or clock sources (tests). */
export function gameRoomWith({ seedSource, clock, spawnPlacer }: GameRoomOverrides): typeof GameRoom {
  return class extends GameRoom {
    protected nextMazeSeed: MazeSeedSource = seedSource ?? randomMazeSeed;
    protected now: Clock = clock ?? Date.now;
    protected placeSpawn: SpawnPlacer = spawnPlacer ?? ((_team, position) => position);
  };
}

/** A GameRoom whose maze seeds come from a trusted server-side source (tests). */
export function gameRoomWithSeedSource(source: MazeSeedSource): typeof GameRoom {
  return gameRoomWith({ seedSource: source });
}
