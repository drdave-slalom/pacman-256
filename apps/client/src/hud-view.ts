import type { GameRoomSnapshot, PlayerSnapshot, PickupKind } from "@maze/shared";

export const PICKUP_CUES: Record<PickupKind, { symbol: string; label: string }> = {
  speed: { symbol: "△", label: "Speed" },
  shield: { symbol: "□", label: "Shield" },
  vulnerability: { symbol: "◇", label: "Reverse (runners only)" },
};

/** Timers are a display of simulation deadlines, never local gameplay decisions. */
export function effectStatus(snapshot: GameRoomSnapshot, localId: string): string {
  if (snapshot.phase !== "playing") return "";
  const p = snapshot.players[localId];
  const seconds = (end: number) => Math.max(0, (end - snapshot.simulationTime) / 1000).toFixed(1);
  return `△ Speed ${seconds(p?.speedEndsAt ?? 0)}s · □ Shield ${seconds(p?.shieldEndsAt ?? 0)}s · ◇ Global reversal ${seconds(snapshot.vulnerabilityEndsAt)}s`;
}

export function playerEffectCue(snapshot: GameRoomSnapshot, player: PlayerSnapshot): string {
  if (snapshot.phase !== "playing" || !player.alive) return "";
  const shield = snapshot.simulationTime < player.shieldEndsAt;
  const vulnerable = player.team === "hunter" && snapshot.simulationTime < snapshot.vulnerabilityEndsAt && !shield;
  return [shield ? "□ SHIELD" : "", vulnerable ? "◇ EXPOSED" : "", snapshot.simulationTime < player.speedEndsAt ? "△" : ""].filter(Boolean).join(" ");
}

/**
 * Pure client view model for the T6 match HUD, spectator mode, and results
 * overlay. No DOM or Phaser access, so these run under `node --test`.
 * Everything here derives strictly from the authoritative server snapshot:
 * the client never guesses a phase, a round outcome, or a winner.
 */

/** Maze phases render the seeded maze and spawned players. */
export function isMazePhase(snapshot: GameRoomSnapshot): boolean {
  return (
    snapshot.roundId !== "" &&
    (snapshot.phase === "countdown" || snapshot.phase === "playing" || snapshot.phase === "results")
  );
}

/** `m:ss` clock formatting; clamps negative input to `0:00`. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Whole seconds until the countdown ends (rounded up, clamped at 0). */
export function countdownRemaining(snapshot: GameRoomSnapshot): number {
  if (snapshot.phase !== "countdown") {
    return 0;
  }
  return Math.max(0, Math.ceil((snapshot.countdownEndsAt - snapshot.serverTime) / 1000));
}

/** Milliseconds left in the round (display only; clamped at 0). */
export function roundTimeRemaining(snapshot: GameRoomSnapshot): number {
  if (snapshot.phase !== "playing") {
    return 0;
  }
  return Math.max(0, snapshot.roundEndsAt - snapshot.serverTime);
}

export interface AliveCounts {
  hunter: number;
  runner: number;
}

/** Alive players per team from the server roster (unassigned is ignored). */
export function aliveCounts(snapshot: GameRoomSnapshot): AliveCounts {
  let hunter = 0;
  let runner = 0;
  for (const player of Object.values(snapshot.players)) {
    if (!player.alive) {
      continue;
    }
    if (player.team === "hunter") {
      hunter += 1;
    } else if (player.team === "runner") {
      runner += 1;
    }
  }
  return { hunter, runner };
}

/** Steering is only valid for an alive local player during the playing phase. */
export function canSteer(snapshot: GameRoomSnapshot, localId: string): boolean {
  if (snapshot.phase !== "playing" || snapshot.roundId === "") {
    return false;
  }
  const local = snapshot.players[localId];
  return local?.alive ?? false;
}

/** Whether the local player has been eliminated this round. */
export function isLocalEliminated(snapshot: GameRoomSnapshot, localId: string): boolean {
  const local = snapshot.players[localId];
  return local !== undefined ? !local.alive : false;
}

/** Structured result view; `null` unless the room is in `results`. */
export interface ResultView {
  /** Winner display label from `resultWinner` (`""` for generic/unknown). */
  winner: string;
  /** Reason display label from `resultReason` (`""` for generic/unknown). */
  reason: string;
  /** Full one-line result text (the `Round over: …` line). */
  line: string;
}

/**
 * Server-declared winner/reason text. Every readable line maps a concrete
 * `resultWinner`/`resultReason` pair; nothing is ever inferred locally, and
 * any other pair yields only the generic `Round over.` line.
 */
const RESULT_ENTRIES: Readonly<Record<string, { winner: string; reason: string }>> = {
  "hunter:teamEliminated": { winner: "Hunters win", reason: "all runners eliminated" },
  "runner:teamEliminated": { winner: "Runners win", reason: "all hunters eliminated" },
  "runner:timeout": { winner: "Runners win", reason: "survived to the deadline" },
  "none:simultaneousWipe": { winner: "Draw", reason: "both teams eliminated at once" },
  "none:abandoned": { winner: "No winner", reason: "all players left" },
};

export function resultView(snapshot: GameRoomSnapshot): ResultView | null {
  if (snapshot.phase !== "results") {
    return null;
  }
  const entry = RESULT_ENTRIES[`${snapshot.resultWinner}:${snapshot.resultReason}`];
  if (!entry) {
    return { winner: "", reason: "", line: "Round over." };
  }
  return { winner: entry.winner, reason: entry.reason, line: `Round over: ${entry.winner}: ${entry.reason}.` };
}
