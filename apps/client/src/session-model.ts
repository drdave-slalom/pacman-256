import {
  INPUT_RATE_LIMIT_MAX_MESSAGES,
  INPUT_RATE_LIMIT_WINDOW_MS,
  PATCH_INTERVAL_MS,
} from "@maze/shared";
import type {
  ActionResultMessage,
  Direction,
  ErrorCode,
  GameRoomSnapshot,
  PlayerTeam,
  SetDirectionMessage,
} from "@maze/shared";

/**
 * Pure client-side helpers for the T3 game room: round detection, snapshot →
 * view mapping, movement-input dedupe/sequencing, and patch interpolation.
 * No DOM or Phaser access, so these run under `node --test`.
 */

/** A round is active only while playing with a server-assigned round ID (seed 0 is valid). */
export function isRoundActive(snapshot: GameRoomSnapshot): boolean {
  return snapshot.phase === "playing" && snapshot.roundId !== "";
}

/** Identity of the maze to render; changes whenever the round or seed changes. */
export function mazeKey(snapshot: GameRoomSnapshot): string | null {
  return isRoundActive(snapshot) ? `${snapshot.roundId}:${snapshot.mazeSeed}` : null;
}

export interface PlayerView {
  id: string;
  displayName: string;
  team: PlayerTeam;
  isLocal: boolean;
  isHost: boolean;
  x: number;
  y: number;
}

/** Players in synchronized (join) order with local/host flags. */
export function playerViews(snapshot: GameRoomSnapshot, localId: string): PlayerView[] {
  return Object.values(snapshot.players).map((player) => ({
    id: player.id,
    displayName: player.displayName,
    team: player.team,
    isLocal: player.id === localId,
    isHost: player.id === snapshot.hostPlayerId,
    x: player.x,
    y: player.y,
  }));
}

/**
 * Client-side input budget per `INPUT_RATE_LIMIT_WINDOW_MS`. Kept below the
 * server's `INPUT_RATE_LIMIT_MAX_MESSAGES` so network jitter (several sends
 * arriving inside one server-side window) does not trip `RATE_LIMITED`.
 */
export const CLIENT_INPUT_BUDGET = INPUT_RATE_LIMIT_MAX_MESSAGES - 4;

/**
 * Builds `setDirection` payloads. Only a change of requested direction produces
 * a message (never per frame or key repeat); the sequence restarts at 0 for
 * each new round. A client-side sliding window keeps input under the budget;
 * a change made while over budget is held (latest wins) and released by
 * `flush` once the window frees a slot.
 */
export class DirectionSender {
  #roundId = "";
  #sequence = 0;
  #lastDirection: Direction | null = null;
  #held: Direction | null = null;
  #sentAt: number[] = [];
  readonly #maxMessages: number;
  readonly #windowMs: number;

  constructor(maxMessages = CLIENT_INPUT_BUDGET, windowMs = INPUT_RATE_LIMIT_WINDOW_MS) {
    this.#maxMessages = maxMessages;
    this.#windowMs = windowMs;
  }

  /**
   * Returns the message to send now, or `null` when the request is a
   * duplicate, there is no round, or the budget is spent (then the direction
   * is held for `flush`).
   */
  next(roundId: string, direction: Direction, now: number): SetDirectionMessage | null {
    if (roundId === "") {
      return null;
    }
    if (roundId !== this.#roundId) {
      this.#roundId = roundId;
      this.#sequence = 0;
      this.#lastDirection = null;
      this.#held = null;
    }
    if (direction === this.#lastDirection) {
      // Back to what the server already has: nothing newer is pending.
      this.#held = null;
      return null;
    }
    if (!this.#hasBudget(now)) {
      this.#held = direction;
      return null;
    }
    return this.#emit(direction, now);
  }

  /** Send the held direction if the round still matches and budget has freed. */
  flush(roundId: string, now: number): SetDirectionMessage | null {
    const held = this.#held;
    if (held === null) {
      return null;
    }
    if (roundId === "" || roundId !== this.#roundId) {
      // A held direction never carries over to another round (or no round).
      this.#held = null;
      return null;
    }
    if (!this.#hasBudget(now)) {
      return null;
    }
    return this.#emit(held, now);
  }

  /** Whether a direction is waiting for budget. */
  get hasHeld(): boolean {
    return this.#held !== null;
  }

  /** Milliseconds until the oldest send leaves the window (0 when budget is free). */
  msUntilBudget(now: number): number {
    this.#prune(now);
    if (this.#sentAt.length < this.#maxMessages) {
      return 0;
    }
    return Math.max(0, this.#sentAt[0]! + this.#windowMs - now);
  }

  /**
   * The server dropped input with RATE_LIMITED, so the last sent direction may
   * not have been applied. Re-hold it (unless a newer change is already held)
   * so `flush` resends it automatically once budget frees.
   */
  onRateLimited(): void {
    if (this.#held === null && this.#lastDirection !== null) {
      this.#held = this.#lastDirection;
    }
    this.#lastDirection = null;
  }

  #prune(now: number): void {
    this.#sentAt = this.#sentAt.filter((time) => now - time < this.#windowMs);
  }

  #hasBudget(now: number): boolean {
    this.#prune(now);
    return this.#sentAt.length < this.#maxMessages;
  }

  #emit(direction: Direction, now: number): SetDirectionMessage {
    this.#sentAt.push(now);
    this.#lastDirection = direction;
    this.#held = null;
    const message: SetDirectionMessage = { roundId: this.#roundId, sequence: this.#sequence, direction };
    this.#sequence += 1;
    return message;
  }
}

/** How a pending lobby action ended. */
export type ActionOutcome =
  | { kind: "accepted" }
  | { kind: "rejected"; code: ErrorCode; message?: string }
  | { kind: "timeout" };

/**
 * Tracks the single in-flight `chooseTeam`/`startMatch` request. Every request
 * ends exactly once (accepted, rejected, or timed out); anything that arrives
 * for another or an already-finished request is ignored.
 */
export class PendingAction {
  #requestId: string | null = null;

  get busy(): boolean {
    return this.#requestId !== null;
  }

  /** Start tracking a request; returns `false` while another one is pending. */
  begin(requestId: string): boolean {
    if (this.#requestId !== null) {
      return false;
    }
    this.#requestId = requestId;
    return true;
  }

  /** Resolve from a correlated `actionResult`; `null` when it is not for the pending request. */
  onActionResult(result: ActionResultMessage): ActionOutcome | null {
    if (this.#requestId === null || result.requestId !== this.#requestId) {
      return null;
    }
    this.#requestId = null;
    return result.accepted
      ? { kind: "accepted" }
      : { kind: "rejected", code: result.code, message: result.message };
  }

  /**
   * Resolve from an uncorrelated `inputRejected`. The server answers a
   * malformed `chooseTeam`/`startMatch` whose `requestId` it cannot read with
   * `inputRejected` INVALID_INPUT instead of an `actionResult` (accepted spec
   * deviation), so that reply must end the pending request rather than leave
   * it hanging until the timeout. Other codes are about movement input and are
   * not replies to the pending action.
   */
  onInputRejected(code: ErrorCode): ActionOutcome | null {
    if (this.#requestId === null || code !== "INVALID_INPUT") {
      return null;
    }
    this.#requestId = null;
    return { kind: "rejected", code };
  }

  /** The request's timer fired; `null` when it already finished (or is another request). */
  onTimeout(requestId: string): ActionOutcome | null {
    if (this.#requestId === null || requestId !== this.#requestId) {
      return null;
    }
    this.#requestId = null;
    return { kind: "timeout" };
  }

  /** Drop the pending request without an outcome (the room was left). */
  cancel(): void {
    this.#requestId = null;
  }
}

/** Room codes are Colyseus room IDs; anything else cannot match a room. */
const ROOM_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isPlausibleRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** Distance (tiles) beyond which a player snaps instead of gliding (spawns, new rounds). */
export const SNAP_DISTANCE_TILES = 2;

interface Track {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
}

/** Linear interpolation from the last rendered position to each new server position over one patch interval. */
export class Interpolator {
  readonly #tracks = new Map<string, Track>();
  readonly #durationMs: number;

  constructor(durationMs = PATCH_INTERVAL_MS) {
    this.#durationMs = durationMs;
  }

  update(players: ReadonlyArray<{ id: string; x: number; y: number }>, now: number): void {
    const seen = new Set<string>();
    for (const { id, x, y } of players) {
      seen.add(id);
      const track = this.#tracks.get(id);
      if (track && track.toX === x && track.toY === y) {
        continue;
      }
      const current = track ? this.sample(id, now) : null;
      const from =
        current === null || Math.hypot(x - current.x, y - current.y) > SNAP_DISTANCE_TILES
          ? { x, y }
          : current;
      this.#tracks.set(id, {
        fromX: from.x,
        fromY: from.y,
        toX: x,
        toY: y,
        start: now,
      });
    }
    for (const id of this.#tracks.keys()) {
      if (!seen.has(id)) {
        this.#tracks.delete(id);
      }
    }
  }

  sample(id: string, now: number): { x: number; y: number } | null {
    const track = this.#tracks.get(id);
    if (!track) {
      return null;
    }
    const t = Math.min(1, Math.max(0, (now - track.start) / this.#durationMs));
    return {
      x: track.fromX + (track.toX - track.fromX) * t,
      y: track.fromY + (track.toY - track.fromY) * t,
    };
  }

  clear(): void {
    this.#tracks.clear();
  }
}

/** Close code Colyseus uses when the server drops a client with an error (incl. the message flood cap). */
export const CLOSE_WITH_ERROR = 4002;
const CLOSE_CONSENTED = 4000;
const CLOSE_NORMAL = 1000;

/** Player-facing text for an unexpected room leave, or `null` for a normal/requested leave. */
export function leaveMessage(code: number, requested: boolean): string | null {
  if (requested || code === CLOSE_CONSENTED || code === CLOSE_NORMAL) {
    return null;
  }
  if (code === CLOSE_WITH_ERROR) {
    return "The server disconnected you (too many messages or a server error). Create or join a room again.";
  }
  return `Lost connection to the room (code ${code}). Check your network, then create or join a room again.`;
}
