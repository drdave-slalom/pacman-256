export const PROTOCOL_VERSION = 1;
export const CONNECTION_ROOM = "connection-check";

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

export {
  CLIENT_MESSAGES,
  ERROR_CODES,
  ERROR_MESSAGES,
  GAME_ROOM,
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  INPUT_RATE_LIMIT_WINDOW_MS,
  MAX_CLIENT_MESSAGES_PER_SECOND,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_ROUND_ID_LENGTH,
  MAX_TEAM_SIZE,
  PATCH_INTERVAL_MS,
  SERVER_MESSAGES,
  SIMULATION_DT_SECONDS,
  SIMULATION_HZ,
  errorMessage,
  isDirection,
  isErrorCode,
  joinErrorCode,
  joinErrorText,
  parseActionResult,
  parseChooseTeam,
  parseDisplayName,
  parseInputRejected,
  parseJoinOptions,
  parseReturnToLobby,
  parseSetDirection,
  parseStartMatch,
  readRequestId,
} from "./protocol.ts";
export type {
  ActionResultMessage,
  ChooseTeamMessage,
  ErrorCode,
  GameRoomSnapshot,
  InputRejectedMessage,
  JoinOptions,
  PlayerSnapshot,
  PlayerTeam,
  QueuedDirection,
  ReturnToLobbyMessage,
  SetDirectionMessage,
  StartMatchMessage,
} from "./protocol.ts";

export { CONTACT_DISTANCE_TILES, evaluateRoundOutcome, sweptContact } from "./round.ts";
export type { ResultReason, ResultWinner } from "./round.ts";

export { SPAWN_CORNER_INSET_TILES, findSpawnCells, spawnDirection } from "./spawn.ts";
export type { SpawnCell, SpawnCells } from "./spawn.ts";
