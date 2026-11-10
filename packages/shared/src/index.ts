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
