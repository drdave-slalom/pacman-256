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
  SIMULATION_DT_SECONDS,
  SIMULATION_HZ,
  errorMessage,
  findSpawnCells,
  generateMaze,
  isProtocolCompatible,
  joinErrorText,
  parseChooseTeam,
  parseJoinOptions,
  parseSetDirection,
  parseStartMatch,
  readRequestId,
  spawnDirection,
  stepPlayerMove,
  type ActionResultMessage,
  type Direction,
  type ErrorCode,
  type InputRejectedMessage,
  type PlayerTeam,
  type QueuedDirection,
  type RoomPhase,
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
  players: t.map(PlayerState),
});
type GameState = InstanceType<typeof GameState>;

/** Produces the server-chosen maze seed for each round (uint32). */
export type MazeSeedSource = () => number;

const UINT32_RANGE = 0x1_0000_0000;

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
 * 30 Hz movement. Countdown, contact, pickups, and round end belong to T5/T6.
 */
export class GameRoom extends Room<{ state: GameState }> {
  maxClients = GAME_RULES.maxPlayers;

  /** Overridden only by trusted server code (tests); never by client options. */
  protected nextMazeSeed: MazeSeedSource = randomMazeSeed;

  #maze: readonly string[] | null = null;
  readonly #joinOrder: string[] = [];
  readonly #recentInputs = new Map<string, number[]>();
  /** Last time each client was told RATE_LIMITED (one notice per window). */
  readonly #rateLimitNoticeAt = new Map<string, number>();

  async onCreate(options: unknown): Promise<void> {
    const code = this.#joinOptionsError(options);
    if (code) {
      throw joinError(code);
    }
    this.setState(new GameState({ roomCode: this.roomId, serverTime: Date.now() }));
    this.patchRate = PATCH_INTERVAL_MS;
    this.maxMessagesPerSecond = MAX_CLIENT_MESSAGES_PER_SECOND;
    await this.setPrivate(true);

    this.onMessage(CLIENT_MESSAGES.chooseTeam, (client, payload: unknown) => this.#chooseTeam(client, payload));
    this.onMessage(CLIENT_MESSAGES.startMatch, (client, payload: unknown) => this.#startMatch(client, payload));
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
    this.state.serverTime = Date.now();
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
      player.alive = true;
      player.x = cell.col + 0.5;
      player.y = cell.row + 0.5;
      player.direction = spawnDirection(maze, cell);
      player.queuedDirection = "";
      player.lastInputSequence = -1;
    }
    this.#maze = maze;
    this.#recentInputs.clear();
    this.#rateLimitNoticeAt.clear();
    this.state.mazeSeed = seed;
    this.state.roundId = randomUUID();
    this.state.phase = "playing";
    this.#changed();
    this.#respond(client, request.requestId, null);
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

  #tick(): void {
    const maze = this.#maze;
    if (this.state.phase === "playing" && maze) {
      this.state.players.forEach((player: PlayerState) => {
        if (!player.alive) {
          return;
        }
        const next = stepPlayerMove(
          {
            position: { x: player.x, y: player.y },
            direction: player.direction,
            queuedDirection: player.queuedDirection === "" ? null : player.queuedDirection,
          },
          DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
          SIMULATION_DT_SECONDS,
          maze,
        );
        player.x = next.position.x;
        player.y = next.position.y;
        player.direction = next.direction;
        player.queuedDirection = next.queuedDirection ?? "";
      });
    }
    this.#changed();
  }
}

/** A GameRoom whose maze seeds come from a trusted server-side source (tests). */
export function gameRoomWithSeedSource(source: MazeSeedSource): typeof GameRoom {
  return class extends GameRoom {
    protected nextMazeSeed: MazeSeedSource = source;
  };
}
