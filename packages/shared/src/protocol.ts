import type { Direction, RoomPhase, Team } from "./index.ts";
import type { ResultReason, ResultWinner } from "./round.ts";

/**
 * T3 wire protocol for the private game room (see
 * SPEC/T3-private-rooms-and-synchronized-movement.md and GAME-CONTRACT.md §2/§3/§7).
 *
 * TypeScript types alone do not validate network input: every inbound payload
 * must go through the `parse*` validators below, which return the parsed value
 * or `null`. Objects with unexpected keys are rejected so a client cannot smuggle
 * identity, position, speed, seed, or phase fields into a request.
 */

/** Colyseus room name for the private game room. */
export const GAME_ROOM = "game";

/** Fixed server simulation rate (contract §3 starting tuning). */
export const SIMULATION_HZ = 30;
/** Fixed simulation step, in seconds. */
export const SIMULATION_DT_SECONDS = 1 / SIMULATION_HZ;
/** Server state patch interval (~20 Hz, contract §3 starting tuning). */
export const PATCH_INTERVAL_MS = 50;

export const MAX_DISPLAY_NAME_LENGTH = 16;
export const MAX_REQUEST_ID_LENGTH = 64;
export const MAX_ROUND_ID_LENGTH = 64;

/**
 * Per-connection `setDirection` rate limit: at most this many accepted inputs
 * within any sliding window of `INPUT_RATE_LIMIT_WINDOW_MS`. Tunable starting
 * value; the exact limit still needs review (contract §2).
 */
export const INPUT_RATE_LIMIT_MAX_MESSAGES = 20;
export const INPUT_RATE_LIMIT_WINDOW_MS = 1_000;

/**
 * Hard per-connection flood cap across all message types, enforced by Colyseus
 * (`Room.maxMessagesPerSecond`): a client exceeding it is disconnected. Set well
 * above legitimate use; `setDirection` is separately limited by the values above.
 */
export const MAX_CLIENT_MESSAGES_PER_SECOND = 60;

/** Visible failure codes (contract §7). */
export const ERROR_CODES = [
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "JOIN_CLOSED",
  "TEAM_FULL",
  // Client-warning-only since D054: retained as a contract-visible code, but
  // the server never emits it as a rejection; the client derives live
  // hunter/runner counts and warns locally instead.
  "TEAMS_UNBALANCED",
  "HOST_REQUIRED",
  "INVALID_PHASE",
  "INVALID_INPUT",
  "STALE_ROUND",
  "PROTOCOL_MISMATCH",
  "RATE_LIMITED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/** Player-facing, actionable message for each failure code. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  ROOM_NOT_FOUND: "That room code was not found. Check the code or create a new room.",
  ROOM_FULL: "That room is full (4 players). Ask the host for another room.",
  JOIN_CLOSED: "That match has already started. Wait for the next lobby or create a room.",
  // D054: the per-team cap was removed, so the server never emits TEAM_FULL;
  // retained here for contract continuity (informative copy only).
  TEAM_FULL: "That team is full. Pick the other team.",
  TEAMS_UNBALANCED: "Teams are unbalanced (one side has fewer players). Warning only; the host can still start.",
  HOST_REQUIRED: "Only the host can do that.",
  INVALID_PHASE: "That action is not available right now.",
  INVALID_INPUT: "The request was invalid. Check your input and try again.",
  STALE_ROUND: "That input was for an earlier round and was ignored.",
  PROTOCOL_MISMATCH: "This game client is out of date. Reload the page.",
  RATE_LIMITED: "Too many inputs too quickly. Slow down.",
};

export function errorMessage(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

/**
 * Text the server uses for join-failure errors: `"<CODE>: <message>"`.
 * `joinErrorCode` parses the prefix back on the client.
 */
export function joinErrorText(code: ErrorCode): string {
  return `${code}: ${ERROR_MESSAGES[code]}`;
}

/** Colyseus matchmaking error code for unknown or locked room IDs. */
const COLYSEUS_INVALID_ROOM_ID = 522;

/**
 * Map a failed `create`/`joinById` (an SDK error) to an `ErrorCode`.
 * Recognizes the server's `"<CODE>: ..."` prefix and the built-in Colyseus
 * room-not-found / room-locked / seat-full errors. Returns `null` for
 * unrecognized failures (for example, the server is unreachable); callers must
 * still show a connection-failure message in that case.
 */
export function joinErrorCode(error: unknown): ErrorCode | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const code = "code" in error && typeof error.code === "number" ? error.code : null;
  const prefix = /^([A-Z_]+):/.exec(message)?.[1];
  if (isErrorCode(prefix)) {
    return prefix;
  }
  // Colyseus reports both a capacity-locked room and a seat-reservation race as
  // locked/full. The game room never locks explicitly; closed joins use JOIN_CLOSED.
  if (/ is locked$| is already full\.?$/.test(message)) {
    return "ROOM_FULL";
  }
  if (code === COLYSEUS_INVALID_ROOM_ID || / not found$/.test(message)) {
    return "ROOM_NOT_FOUND";
  }
  return null;
}

/** Team value in synchronized state; `unassigned` until the player picks. */
export type PlayerTeam = Team | "unassigned";
/** Queued direction in synchronized state; `""` means no queued turn. */
export type QueuedDirection = Direction | "";

/** Client → server message types. */
export const CLIENT_MESSAGES = {
  chooseTeam: "chooseTeam",
  startMatch: "startMatch",
  setDirection: "setDirection",
  returnToLobby: "returnToLobby",
} as const;

/** Server → client message types. */
export const SERVER_MESSAGES = {
  actionResult: "actionResult",
  inputRejected: "inputRejected",
} as const;

/** Options for `client.create(GAME_ROOM, ...)` and `client.joinById(code, ...)`. */
export interface JoinOptions {
  protocolVersion: number;
  displayName: string;
}

export interface ChooseTeamMessage {
  requestId: string;
  team: Team;
}

export interface StartMatchMessage {
  requestId: string;
}

export interface ReturnToLobbyMessage {
  requestId: string;
}

export interface SetDirectionMessage {
  roundId: string;
  sequence: number;
  direction: Direction;
}

/** Correlated response to every `chooseTeam` / `startMatch`. */
export type ActionResultMessage =
  | { requestId: string; accepted: true }
  | { requestId: string; accepted: false; code: ErrorCode; message: string };

/** Sent for malformed/unknown messages and rejected movement input. */
export interface InputRejectedMessage {
  code: ErrorCode;
  message: string;
}

/** JSON view (`state.toJSON()`) of one synchronized player. */
export interface PlayerSnapshot {
  /** Server session ID; never client-supplied. */
  id: string;
  displayName: string;
  team: PlayerTeam;
  alive: boolean;
  /** Fractional tile coordinates (cell centers are at `n + 0.5`). */
  x: number;
  y: number;
  direction: Direction;
  queuedDirection: QueuedDirection;
  /** Last accepted `setDirection` sequence this round; `-1` before any. */
  lastInputSequence: number;
  speedEndsAt: number;
  shieldEndsAt: number;
}

/** JSON view (`state.toJSON()`) of the synchronized game room state. */
export interface GameRoomSnapshot {
  protocolVersion: number;
  /** Private join code (the Colyseus room ID). */
  roomCode: string;
  hostPlayerId: string;
  phase: RoomPhase;
  /** Increments on every state change and simulation tick. */
  revision: number;
  /** Server wall-clock time in epoch milliseconds at the last update. */
  serverTime: number;
  /** Unique per round; `""` in the lobby before the first start. */
  roundId: string;
  /** uint32 seed for `generateMaze`; `0` in the lobby. */
  mazeSeed: number;
  /** Epoch ms when the countdown ends; `0` when not counting down. */
  countdownEndsAt: number;
  /** Epoch ms deadline of the playing round; `0` when not applicable. */
  roundEndsAt: number;
  /** Round winner; `""` until results. */
  resultWinner: ResultWinner | "";
  /** Why the round ended; `""` until results. */
  resultReason: ResultReason | "";
  /** Epoch ms when the round ended; `0` until results. */
  resultEndedAt: number;
  simulationTime: number;
  vulnerabilityEndsAt: number;
  vulnerabilityRespawnAt: number;
  pickups: Record<string, import("./pickups.ts").PickupSnapshot>;
  players: Record<string, PlayerSnapshot>;
}

const TEAMS: readonly Team[] = ["hunter", "runner"];
const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];
/** Control (Cc) and invisible format (Cf, e.g. U+200B, U+202E) characters. */
const CONTROL_OR_FORMAT_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isTeam(value: unknown): value is Team {
  return typeof value === "string" && (TEAMS as readonly string[]).includes(value);
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

/** Trimmed display name of 1..MAX_DISPLAY_NAME_LENGTH characters without control or format characters. */
export function parseDisplayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > MAX_DISPLAY_NAME_LENGTH || CONTROL_OR_FORMAT_CHARACTERS.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Validate create/join options. Does not check version compatibility; callers
 * check `isProtocolCompatible(options.protocolVersion)` first to report
 * `PROTOCOL_MISMATCH` separately from `INVALID_INPUT`.
 */
export function parseJoinOptions(value: unknown): JoinOptions | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["protocolVersion", "displayName"])) {
    return null;
  }
  const { protocolVersion } = value;
  const displayName = parseDisplayName(value.displayName);
  if (typeof protocolVersion !== "number" || !Number.isSafeInteger(protocolVersion) || displayName === null) {
    return null;
  }
  return { protocolVersion, displayName };
}

/** Best-effort `requestId` extraction so a malformed request can still be correlated. */
export function readRequestId(value: unknown): string | null {
  if (!isPlainObject(value) || !isBoundedId(value.requestId, MAX_REQUEST_ID_LENGTH)) {
    return null;
  }
  return value.requestId;
}

export function parseChooseTeam(value: unknown): ChooseTeamMessage | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["requestId", "team"])) {
    return null;
  }
  const { requestId, team } = value;
  if (!isBoundedId(requestId, MAX_REQUEST_ID_LENGTH) || !isTeam(team)) {
    return null;
  }
  return { requestId, team };
}

export function parseStartMatch(value: unknown): StartMatchMessage | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["requestId"])) {
    return null;
  }
  const { requestId } = value;
  if (!isBoundedId(requestId, MAX_REQUEST_ID_LENGTH)) {
    return null;
  }
  return { requestId };
}

export function parseReturnToLobby(value: unknown): ReturnToLobbyMessage | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["requestId"])) {
    return null;
  }
  const { requestId } = value;
  if (!isBoundedId(requestId, MAX_REQUEST_ID_LENGTH)) {
    return null;
  }
  return { requestId };
}

export function parseSetDirection(value: unknown): SetDirectionMessage | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["roundId", "sequence", "direction"])) {
    return null;
  }
  const { roundId, sequence, direction } = value;
  if (
    !isBoundedId(roundId, MAX_ROUND_ID_LENGTH) ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    !isDirection(direction)
  ) {
    return null;
  }
  return { roundId, sequence, direction };
}

/** Client-side validator for server `actionResult` messages. */
export function parseActionResult(value: unknown): ActionResultMessage | null {
  if (!isPlainObject(value) || !isBoundedId(value.requestId, MAX_REQUEST_ID_LENGTH)) {
    return null;
  }
  const { requestId, accepted, code, message } = value;
  if (accepted === true) {
    return { requestId, accepted: true };
  }
  if (accepted === false && isErrorCode(code) && typeof message === "string") {
    return { requestId, accepted: false, code, message };
  }
  return null;
}

/** Client-side validator for server `inputRejected` messages. */
export function parseInputRejected(value: unknown): InputRejectedMessage | null {
  if (!isPlainObject(value) || !isErrorCode(value.code) || typeof value.message !== "string") {
    return null;
  }
  return { code: value.code, message: value.message };
}
