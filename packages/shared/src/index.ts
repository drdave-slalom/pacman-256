export const PROTOCOL_VERSION = 1;
export const CONNECTION_ROOM = "connection-check";

/** Shared private-game room name; T3's server room must register this name. */
export const GAME_ROOM = "game-room";

export const DISPLAY_NAME_MAX_LENGTH = 16;

/**
 * Visible join/login failure codes from the game contract
 * (docs/GAME-CONTRACT.md section 7). The T3 server is expected to surface these;
 * clients map them to readable copy via `describeJoinError`.
 */
export const JOIN_ERROR_CODES = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_FULL: "ROOM_FULL",
  JOIN_CLOSED: "JOIN_CLOSED",
  TEAM_FULL: "TEAM_FULL",
  TEAMS_UNBALANCED: "TEAMS_UNBALANCED",
  HOST_REQUIRED: "HOST_REQUIRED",
  INVALID_PHASE: "INVALID_PHASE",
  INVALID_INPUT: "INVALID_INPUT",
  STALE_ROUND: "STALE_ROUND",
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type JoinErrorCode = (typeof JOIN_ERROR_CODES)[keyof typeof JOIN_ERROR_CODES];

export function isJoinErrorCode(value: unknown): value is JoinErrorCode {
  return (
    typeof value === "string" &&
    (Object.values(JOIN_ERROR_CODES) as readonly string[]).includes(value)
  );
}

/**
 * True for non-empty (after trimming), length-bounded strings with no control
 * characters. The caller should send the trimmed form as `displayName`.
 */
export function isValidDisplayName(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return false;
  }
  for (const character of trimmed) {
    const code = character.codePointAt(0);
    // Reject C0 controls (U+0000–U+001F), DEL (U+007F), and C1 controls
    // (U+0080–U+009F).
    if (
      code !== undefined &&
      (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f))
    ) {
      return false;
    }
  }
  return true;
}

export type Team = "hunter" | "runner";
export type Direction = "up" | "down" | "left" | "right";
export type RoomPhase = "lobby" | "countdown" | "playing" | "results";

export interface ConnectionState {
  protocolVersion: number;
  phase: RoomPhase;
}

export function isProtocolCompatible(value: unknown): boolean {
  return value === PROTOCOL_VERSION;
}

export function isConnectionState(value: unknown): value is ConnectionState {
  return (
    typeof value === "object" &&
    value !== null &&
    "protocolVersion" in value &&
    isProtocolCompatible(value.protocolVersion) &&
    "phase" in value &&
    value.phase === "lobby"
  );
}

export const GAME_RULES = {
  maxPlayers: 4,
  countdownMs: 3_000,
  roundDurationMs: 180_000,
  speedMultiplier: 1.5,
  speedDurationMs: 5_000,
  shieldDurationMs: 3_000,
  vulnerabilityDurationMs: 8_000,
  standardPickupRespawnMs: 15_000,
  vulnerabilityRespawnDelayMs: 10_000,
} as const;

export {
  MAZE_WIDTH,
  MAZE_HEIGHT,
  MAZE_MAP,
  PLAYER_SPAWN,
  isInside,
  isInsideIn,
  isWalkable,
  isWalkableIn,
} from "./map.ts";

export {
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  createPlayerMoveState,
  stepPlayerMove,
} from "./movement.ts";
export type { PlayerMoveState, Vec2 } from "./movement.ts";

export { findSpawnCell, generateMaze } from "./maze-gen.ts";

const JOIN_ERROR_MESSAGES: Record<JoinErrorCode, string> = {
  ROOM_NOT_FOUND: "Room not found. It may have closed or never existed.",
  ROOM_FULL: "That room is full. Try another code or create your own room.",
  JOIN_CLOSED: "Joining is closed for that room right now.",
  TEAM_FULL: "That team is full in the room's lobby.",
  TEAMS_UNBALANCED: "Teams are unbalanced; wait for a balanced lobby.",
  HOST_REQUIRED: "Only the host can perform that action.",
  INVALID_PHASE: "The room is not in a phase that permits that action.",
  INVALID_INPUT: "The server rejected that input as invalid.",
  STALE_ROUND: "That action belongs to a round that already ended.",
  PROTOCOL_MISMATCH: "Protocol version mismatch. Reload with a compatible client.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
};

/**
 * Colyseus matchmaking HTTP errors (see @colyseus/shared-types ErrorCode).
 * Neutral copy: stays accurate after T3 registers `GAME_ROOM`, when 522 will
 * also occur for genuinely bad join codes.
 */
function matchmakeErrorMessage(code: number): string | undefined {
  switch (code) {
    case 520:
      return "Room service not available yet.";
    case 521:
      return "No matching room was found on the server.";
    case 522:
      return "Room not found on the server.";
    case 523:
      return "The server could not handle the request right now. Try again.";
    case 524:
      return "The room request expired. Try again.";
    case 525:
      return "The server rejected the credentials for this room.";
    case 526:
      return "The server reported an application error. Try again.";
    case 4217:
      return "The server rejected the request payload. Reload the page.";
    default:
      return undefined;
  }
}

/**
 * Map a join/create failure to a human-readable message. Accepts the contract's
 * string codes, Colyseus matchmaking numeric codes, or a message that embeds a
 * contract code (e.g. "PROTOCOL_MISMATCH: reload with a compatible client.").
 */
export function describeJoinError(code?: unknown, message?: unknown): string {
  let normalized: unknown = code;
  if (typeof code === "string" && /^\d+$/.test(code)) {
    normalized = Number(code);
  }
  if (isJoinErrorCode(normalized)) {
    return JOIN_ERROR_MESSAGES[normalized];
  }
  if (typeof normalized === "number") {
    const matchmakingMessage = matchmakeErrorMessage(normalized);
    if (matchmakingMessage !== undefined) {
      return matchmakingMessage;
    }
  }
  if (typeof message === "string") {
    for (const knownCode of Object.values(JOIN_ERROR_CODES)) {
      if (message.includes(knownCode)) {
        return JOIN_ERROR_MESSAGES[knownCode];
      }
    }
  }
  const detail = normalized === undefined ? "" : ` (${String(normalized)})`;
  return `Could not join the room${detail}. Try again.`;
}
