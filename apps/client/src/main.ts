import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import {
  CLIENT_MESSAGES,
  CONNECTION_ROOM,
  GAME_ROOM,
  GAME_RULES,
  MAZE_HEIGHT,
  MAZE_WIDTH,
  MAX_DISPLAY_NAME_LENGTH,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  errorMessage,
  isConnectionState,
  isDirection,
  joinErrorCode,
  parseActionResult,
  parseDisplayName,
  parseInputRejected,
} from "@maze/shared";
import type {
  ChooseTeamMessage,
  Direction,
  ErrorCode,
  GameRoomSnapshot,
  JoinOptions,
  ReturnToLobbyMessage,
  StartMatchMessage,
  Team,
} from "@maze/shared";
import { MazeScene, TILE_SIZE } from "./maze-scene.ts";
import type { MazeSceneSource } from "./maze-scene.ts";
import {
  DirectionSender,
  PendingAction,
  isPlausibleRoomCode,
  leaveMessage,
  playerViews,
} from "./session-model.ts";
import type { ActionOutcome } from "./session-model.ts";
import {
  aliveCounts,
  canSteer,
  formatClock,
  isLocalEliminated,
  isMazePhase,
  resultView,
  roundTimeRemaining,
} from "./hud-view.ts";
import { parseAppRoute, serializeAppRoute } from "@maze/shared";
import type { AppRoute } from "@maze/shared";
import "./style.css";

const DISPLAY_NAME_STORAGE_KEY = "maze-workshop.display-name";

function rememberDisplayName(name: string): void {
  try {
    window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
  } catch {
    // Storage may be unavailable; the URL still restores the view.
  }
}

function savedDisplayName(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Mirror the current view in the URL hash without reloading the page. */
function setRouteHash(route: AppRoute): void {
  const hash = serializeAppRoute(route);
  const path = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", hash ? `${path}${hash}` : path);
}

/** How long a lobby action may wait for its `actionResult` before it is re-enabled. */
const ACTION_TIMEOUT_MS = 5_000;
/** How long a transient notice (e.g. RATE_LIMITED) stays visible. */
const TRANSIENT_MESSAGE_MS = 3_000;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Missing required element ${selector}.`);
  }
  return found;
}

const ui = {
  joinPanel: element<HTMLElement>("#join-panel"),
  nameInput: element<HTMLInputElement>("#display-name"),
  createButton: element<HTMLButtonElement>("#create-room"),
  codeInput: element<HTMLInputElement>("#room-code"),
  joinButton: element<HTMLButtonElement>("#join-room"),
  lobbyPanel: element<HTMLElement>("#lobby-panel"),
  lobbyCode: element<HTMLElement>("#lobby-code"),
  copyCodeButton: element<HTMLButtonElement>("#copy-code"),
  playerList: element<HTMLUListElement>("#player-list"),
  hunterButton: element<HTMLButtonElement>("#pick-hunter"),
  runnerButton: element<HTMLButtonElement>("#pick-runner"),
  startButton: element<HTMLButtonElement>("#start-match"),
  returnLobbyButton: element<HTMLButtonElement>("#return-lobby"),
  lobbyHint: element<HTMLElement>("#lobby-hint"),
  lobbyNotice: element<HTMLElement>("#lobby-notice"),
  gamePanel: element<HTMLElement>("#game-panel"),
  gameMount: element<HTMLElement>("#game"),
  hudPhase: element<HTMLElement>("#hud-phase"),
  hudTimer: element<HTMLElement>("#hud-timer"),
  hudHunters: element<HTMLElement>("#hud-hunters"),
  hudRunners: element<HTMLElement>("#hud-runners"),
  hudStatus: element<HTMLElement>("#hud-status"),
  spectatorOverlay: element<HTMLElement>("#spectator-overlay"),
  spectatorText: element<HTMLElement>("#spectator-text"),
  resultsOverlay: element<HTMLElement>("#results-overlay"),
  resultsLine: element<HTMLElement>("#results-line"),
  resultsLocal: element<HTMLElement>("#results-local"),
  dpadButtons: document.querySelectorAll<HTMLButtonElement>("#dpad button[data-direction]"),
  leaveButtons: document.querySelectorAll<HTMLButtonElement>("[data-leave]"),
  message: element<HTMLElement>("#message"),
  connectButton: element<HTMLButtonElement>("#connect"),
  connectStatus: element<HTMLElement>("#status"),
};
ui.nameInput.maxLength = MAX_DISPLAY_NAME_LENGTH;

// The game surface must not scroll or zoom while controlling it.
ui.gameMount.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
ui.gameMount.addEventListener("contextmenu", (event) => event.preventDefault());

// In dev, the Vite dev server proxies /multiplayer to the backend and strips
// the prefix. When the built client is served by the game server itself
// (production/Kubernetes), Colyseus's matchmaking and room routes live at the
// document root, so connect there directly.
const endpoint = new URL(import.meta.env.PROD ? "/" : "/multiplayer", window.location.href);
endpoint.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const client = new Client(endpoint.toString());

type View = "join" | "lobby" | "game";

let room: Room | null = null;
let snapshot: GameRoomSnapshot | null = null;
/** True while a create/join is in flight; blocks concurrent attempts. */
let joining = false;
const pending = new PendingAction();
let pendingTimer: number | undefined;
let requestCounter = 0;
let directionSender = new DirectionSender();
let heldDirectionTimer: number | undefined;
let game: Phaser.Game | null = null;
let renderedLobbyKey = "";
let renderedHudKey = "";
let renderedResultsKey = "";
let messageTimer: number | undefined;

/** Alert-style message for failures; `transient` ones clear themselves. */
function showMessage(text: string, transient = false): void {
  window.clearTimeout(messageTimer);
  messageTimer = undefined;
  ui.message.textContent = text;
  ui.message.hidden = text === "";
  if (transient && text !== "") {
    messageTimer = window.setTimeout(() => showMessage(""), TRANSIENT_MESSAGE_MS);
  }
}

/** Non-alert lobby status text (polite live region). */
function showNotice(text: string): void {
  ui.lobbyNotice.textContent = text;
}

function showView(view: View): void {
  ui.joinPanel.hidden = view !== "join";
  ui.lobbyPanel.hidden = view !== "lobby";
  ui.gamePanel.hidden = view !== "game";
  if (view === "game") {
    startRenderer();
  } else {
    stopRenderer();
  }
}

function startRenderer(): void {
  if (game) {
    return;
  }
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: ui.gameMount,
    width: MAZE_WIDTH * TILE_SIZE,
    height: MAZE_HEIGHT * TILE_SIZE,
    backgroundColor: "#05060a",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  const source: MazeSceneSource = {
    snapshot: () => snapshot,
    localPlayerId: () => room?.sessionId ?? "",
    steer: sendDirection,
  };
  game.scene.add("maze", MazeScene, true, source);
}

/** Destroyed outside play so Phaser's key capture never blocks typing in the forms. */
function stopRenderer(): void {
  game?.destroy(true);
  game = null;
}

/**
 * The single direction-request path for the HTML D-pad, swipe, and keyboard.
 * Input outside an active round or from a non-alive (spectating) player is dropped; the sender dedupes, sequences, and
 * budgets it.
 */
function sendDirection(direction: Direction): void {
  if (!room || !snapshot || !canSteer(snapshot, room.sessionId)) {
    return;
  }
  const message = directionSender.next(snapshot.roundId, direction, performance.now());
  if (message) {
    room.send(CLIENT_MESSAGES.setDirection, message);
  }
  scheduleHeldDirection();
}

/** Release a direction held back by the input budget once a slot frees. */
function scheduleHeldDirection(): void {
  if (heldDirectionTimer !== undefined || !directionSender.hasHeld) {
    return;
  }
  heldDirectionTimer = window.setTimeout(() => {
    heldDirectionTimer = undefined;
    if (!room || !snapshot || !canSteer(snapshot, room.sessionId)) {
      return;
    }
    const message = directionSender.flush(snapshot.roundId, performance.now());
    if (message) {
      room.send(CLIENT_MESSAGES.setDirection, message);
    }
    scheduleHeldDirection();
  }, directionSender.msUntilBudget(performance.now()) + 1);
}

function joinFailureMessage(error: unknown): string {
  const code = joinErrorCode(error);
  if (code === "INVALID_INPUT") {
    return `The server rejected that name. Use 1-${MAX_DISPLAY_NAME_LENGTH} characters without unsupported (control or invisible) characters.`;
  }
  if (code) {
    return errorMessage(code);
  }
  return "Could not reach the game server. Check that it is running and that you are on the same network, then try again.";
}

async function enterRoom(action: "create" | "join"): Promise<void> {
  if (joining || room) {
    return;
  }
  const displayName = parseDisplayName(ui.nameInput.value);
  if (displayName === null) {
    showMessage(`Enter a name of 1-${MAX_DISPLAY_NAME_LENGTH} characters without unsupported (control or invisible) characters.`);
    ui.nameInput.focus();
    return;
  }
  rememberDisplayName(displayName);
  const code = ui.codeInput.value.trim();
  if (action === "join" && code === "") {
    showMessage("Enter the room code from the host.");
    ui.codeInput.focus();
    return;
  }
  if (action === "join" && !isPlausibleRoomCode(code)) {
    // Room codes are Colyseus room IDs; anything else cannot exist.
    showMessage(errorMessage("ROOM_NOT_FOUND"));
    ui.codeInput.focus();
    return;
  }
  const options: JoinOptions = { protocolVersion: PROTOCOL_VERSION, displayName };
  joining = true;
  ui.createButton.disabled = true;
  ui.joinButton.disabled = true;
  showMessage(action === "create" ? "Creating a room..." : "Joining the room...");
  try {
    // A rejected join also makes the SDK log a closed-connection warning in the
    // console; the player sees only the mapped message below.
    const joined = action === "create"
      ? await client.create(GAME_ROOM, options)
      : await client.joinById(code, options);
    if (room) {
      // Defensive: never hold two rooms. A join that resolves after another
      // session was attached is left immediately.
      void joined.leave();
      return;
    }
    attachRoom(joined);
    showMessage("");
  } catch (error) {
    showMessage(joinFailureMessage(error));
  } finally {
    joining = false;
    ui.createButton.disabled = false;
    ui.joinButton.disabled = false;
  }
}

function attachRoom(joined: Room): void {
  room = joined;
  snapshot = null;
  renderedLobbyKey = "";
  directionSender = new DirectionSender();
  ui.lobbyCode.textContent = "";
  ui.playerList.replaceChildren();
  ui.lobbyHint.textContent = "";
  showNotice("");
  setRouteHash({ view: "room", code: joined.roomId });
  // MVP has no reconnect: a dropped socket must end the session right away
  // (visible message + join screen) instead of retrying in the background.
  joined.reconnection.enabled = false;
  // Every handler ignores events from a room that is no longer current, so a
  // stale room can never touch the snapshot, pending action, or session.
  const isCurrent = (): boolean => room === joined;
  joined.onStateChange((state: { toJSON(): unknown }) => {
    if (!isCurrent()) {
      return;
    }
    snapshot = state.toJSON() as GameRoomSnapshot;
    render();
  });
  joined.onMessage(SERVER_MESSAGES.actionResult, (raw: unknown) => {
    if (!isCurrent()) {
      return;
    }
    const result = parseActionResult(raw);
    const outcome = result ? pending.onActionResult(result) : null;
    if (outcome) {
      finishAction(outcome);
    }
  });
  joined.onMessage(SERVER_MESSAGES.inputRejected, (raw: unknown) => {
    if (!isCurrent()) {
      return;
    }
    const rejection = parseInputRejected(raw);
    if (!rejection) {
      return;
    }
    const outcome = pending.onInputRejected(rejection.code);
    if (outcome) {
      finishAction(outcome);
      return;
    }
    handleInputRejection(rejection.code);
  });
  joined.onError((code?: number, message?: string) => {
    if (!isCurrent()) {
      return;
    }
    // Transport errors arrive without a code; onLeave reports the disconnect.
    console.debug("Room error", code, message);
    if (typeof code === "number") {
      showMessage("The game server reported an error. If play stops, leave and join again.");
    }
  });
  joined.onLeave((code: number) => {
    if (!isCurrent()) {
      return;
    }
    // A requested leave resets the session first, so only unexpected leaves reach here.
    const text = leaveMessage(code, false);
    resetSession();
    showMessage(text ?? "");
  });
  // The first state arrives right after joining; show the lobby meanwhile.
  showView("lobby");
}

function handleInputRejection(code: ErrorCode): void {
  if (code === "STALE_ROUND") {
    // Expected around round changes; not worth a visible message (contract §7).
    console.debug("Input ignored by the server: STALE_ROUND");
    return;
  }
  if (code === "RATE_LIMITED") {
    directionSender.onRateLimited();
    scheduleHeldDirection();
    showMessage(errorMessage(code), true);
    return;
  }
  showMessage(errorMessage(code));
}

function resetSession(): void {
  clearPending();
  window.clearTimeout(heldDirectionTimer);
  heldDirectionTimer = undefined;
  setLobbyBusy(false);
  room = null;
  snapshot = null;
  setRouteHash({ view: "lobby" });
  showView("join");
}

function sendAction(
  type: "chooseTeam" | "startMatch" | "returnToLobby",
  payload: (requestId: string) => ChooseTeamMessage | StartMatchMessage | ReturnToLobbyMessage,
): void {
  if (!room) {
    return;
  }
  const requestId = `${type}-${++requestCounter}`;
  if (!pending.begin(requestId)) {
    return;
  }
  pendingTimer = window.setTimeout(() => {
    const outcome = pending.onTimeout(requestId);
    if (outcome) {
      finishAction(outcome);
    }
  }, ACTION_TIMEOUT_MS);
  setLobbyBusy(true);
  showMessage("");
  showNotice("");
  room.send(type, payload(requestId));
}

function clearPending(): void {
  pending.cancel();
  window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
}

function finishAction(outcome: ActionOutcome): void {
  window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
  setLobbyBusy(false);
  if (outcome.kind === "accepted") {
    showMessage("");
  } else if (outcome.kind === "rejected") {
    showMessage(outcome.message ?? errorMessage(outcome.code));
  } else {
    showMessage("The server did not answer in time. Try again.");
  }
}

function setLobbyBusy(busy: boolean): void {
  ui.hunterButton.disabled = busy;
  ui.runnerButton.disabled = busy;
  ui.startButton.disabled = busy;
  ui.returnLobbyButton.disabled = busy;
}

const TEAM_LABELS = { hunter: "Hunters", runner: "Runners", unassigned: "no team yet" } as const;

/** Spectator notice, set only when the overlay is revealed so the polite live region announces it. */
const SPECTATOR_TEXT = "You were eliminated. Spectating until the round ends.";

function render(): void {
  if (!room || !snapshot) {
    return;
  }
  const localId = room.sessionId;
  if (isMazePhase(snapshot)) {
    showView("game");
    renderGame(snapshot, localId);
    return;
  }
  showView("lobby");
  renderLobby(snapshot, localId);
}

function renderLobby(snapshot: GameRoomSnapshot, localId: string): void {
  renderedHudKey = "";
  renderedResultsKey = "";
  const players = playerViews(snapshot, localId);
  const isHost = snapshot.hostPlayerId === localId;
  // Patches arrive ~20 Hz even in the lobby; only touch the DOM when the roster changes.
  const lobbyKey = JSON.stringify([snapshot.roomCode, snapshot.phase, isHost, players.map((p) => [p.id, p.displayName, p.team, p.isHost])]);
  if (lobbyKey === renderedLobbyKey) {
    return;
  }
  renderedLobbyKey = lobbyKey;
  ui.lobbyCode.textContent = snapshot.roomCode;
  ui.playerList.replaceChildren(
    ...players.map((player) => {
      const item = document.createElement("li");
      item.dataset.team = player.team;
      const tags = [player.isHost ? "host" : "", player.isLocal ? "you" : ""].filter(Boolean).join(", ");
      item.textContent = `${player.displayName}: ${TEAM_LABELS[player.team]}${tags ? ` (${tags})` : ""}`;
      return item;
    }),
  );
  // Lobby-only controls (this function runs only while phase === "lobby").
  ui.hunterButton.hidden = false;
  ui.runnerButton.hidden = false;
  ui.startButton.hidden = !isHost;
  // Return-to-lobby lives in the results overlay during the results phase.
  ui.returnLobbyButton.hidden = true;
  const hunters = players.filter((player) => player.team === "hunter").length;
  const runners = players.filter((player) => player.team === "runner").length;
  const unassigned = players.length - hunters - runners;
  const counterText = `Hunters: ${hunters} · Runners: ${runners}`;
  // Start requires every connected player to have picked and at least one per team.
  const canStart = unassigned === 0 && hunters >= 1 && runners >= 1;
  ui.startButton.disabled = pending.busy || !canStart;
  if (unassigned > 0) {
    ui.lobbyHint.textContent = counterText;
    showNotice(`${unassigned} player${unassigned === 1 ? " hasn't" : "s haven't"} picked a team yet.`);
  } else if (hunters < 1 || runners < 1) {
    ui.lobbyHint.textContent = counterText;
    showNotice("Need at least one hunter and one runner to start.");
  } else if (hunters !== runners) {
    ui.lobbyHint.textContent = counterText;
    showNotice(`Lobby unbalanced: Hunters ${hunters} : Runners ${runners}. A team can win with fewer players; you can still start.`);
  } else {
    ui.lobbyHint.textContent = counterText;
    showNotice("");
  }
}

function renderGame(snapshot: GameRoomSnapshot, localId: string): void {
  const phase = snapshot.phase;
  const counts = aliveCounts(snapshot);
  // One prominent countdown readout lives in the scene (Phaser numeral) while
  // the HUD timer shows the round clock: its length during countdown, then the
  // time remaining while playing.
  const timer =
    phase === "playing"
      ? formatClock(roundTimeRemaining(snapshot))
      : phase === "countdown"
        ? formatClock(GAME_RULES.roundDurationMs)
        : "";
  // The local client always has a roster entry while a maze phase renders; the
  // server keeps one player record per connected client.
  const local = snapshot.players[localId]!;
  const statusText = local.alive
    ? `you: ${TEAM_LABELS[local.team]}`
    : "you: eliminated — spectating";
  // Patch-rate safe: rewrite the HUD only when a derived string changed.
  const hudKey = JSON.stringify([phase, timer, counts, statusText]);
  if (hudKey !== renderedHudKey) {
    renderedHudKey = hudKey;
    ui.hudPhase.textContent = phase === "countdown" ? "Countdown" : phase === "playing" ? "Playing" : "Results";
    ui.hudPhase.dataset.phase = phase;
    ui.hudTimer.textContent = timer;
    ui.hudHunters.textContent = String(counts.hunter);
    ui.hudRunners.textContent = String(counts.runner);
    ui.hudStatus.textContent = statusText;
  }
  // Spectator overlay: shown while the local player is eliminated during play.
  // The notice is set only at reveal so its polite live region announces the
  // elimination instead of riding on the HUD status.
  const spectating = phase === "playing" && isLocalEliminated(snapshot, localId);
  if (spectating) {
    if (ui.spectatorOverlay.hidden) {
      ui.spectatorText.textContent = SPECTATOR_TEXT;
    }
  } else if (ui.spectatorText.textContent !== "") {
    ui.spectatorText.textContent = "";
  }
  ui.spectatorOverlay.hidden = !spectating;
  // Results overlay: exactly the server-declared line; host returns to lobby.
  const result = resultView(snapshot);
  const isHost = snapshot.hostPlayerId === localId;
  if (result !== null) {
    const localEliminated = isLocalEliminated(snapshot, localId);
    const resultsKey = JSON.stringify([result.line, isHost, localEliminated]);
    if (resultsKey !== renderedResultsKey) {
      renderedResultsKey = resultsKey;
      ui.resultsLine.textContent = result.line + (isHost ? "" : " Waiting for the host to return to the lobby.");
      ui.resultsLocal.textContent = localEliminated ? "You were eliminated." : "";
      ui.returnLobbyButton.hidden = !isHost;
    }
  } else {
    renderedResultsKey = "";
  }
  ui.resultsOverlay.hidden = result === null;
  const steerable = canSteer(snapshot, localId);
  for (const button of ui.dpadButtons) {
    button.disabled = !steerable;
  }
}
  }
}

function pickTeam(team: Team): void {
  sendAction(CLIENT_MESSAGES.chooseTeam, (requestId) => ({ requestId, team }));
}

ui.createButton.addEventListener("click", () => void enterRoom("create"));
ui.joinButton.addEventListener("click", () => void enterRoom("join"));
ui.codeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.repeat) {
    void enterRoom("join");
  }
});
ui.hunterButton.addEventListener("click", () => pickTeam("hunter"));
ui.runnerButton.addEventListener("click", () => pickTeam("runner"));
ui.startButton.addEventListener("click", () => {
  sendAction(CLIENT_MESSAGES.startMatch, (requestId) => ({ requestId }));
});
ui.returnLobbyButton.addEventListener("click", () => {
  sendAction(CLIENT_MESSAGES.returnToLobby, (requestId) => ({ requestId }));
});
ui.copyCodeButton.addEventListener("click", async () => {
  const code = snapshot?.roomCode ?? "";
  try {
    await navigator.clipboard.writeText(code);
    showNotice("Room code copied.");
  } catch {
    showNotice(`Copy failed. Share the code manually: ${code}`);
  }
});
for (const button of ui.leaveButtons) {
  button.addEventListener("click", () => {
    const leaving = room;
    if (!leaving) {
      return;
    }
    // Update the UI now; the stale-room guards ignore the room's late events.
    resetSession();
    showMessage("");
    void leaving.leave();
  });
}

// HTML D-pad below the maze. It lives in the game panel, so it is hidden
// outside play, and sendDirection drops presses when no round is active.
for (const button of ui.dpadButtons) {
  const direction = button.dataset.direction;
  if (!isDirection(direction)) {
    continue;
  }
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    sendDirection(direction);
  });
  // Keyboard activation (Enter/Space on a focused button) fires a click with
  // detail 0; pointer clicks were already handled on pointerdown.
  button.addEventListener("click", (event) => {
    if (event.detail === 0) {
      sendDirection(direction);
    }
  });
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

showView("join");

// Restore any saved display name so a refresh can rejoin a room.
const savedName = savedDisplayName();
if (savedName !== null) {
  ui.nameInput.value = savedName;
}

// Restore the view from the URL hash: auto-rejoin a room if one was open.
const initialRoute = parseAppRoute(window.location.hash);
if (initialRoute.view === "room") {
  if (isPlausibleRoomCode(initialRoute.code)) {
    ui.codeInput.value = initialRoute.code;
    void enterRoom("join");
  } else {
    showMessage("The saved room code is invalid. Enter a code to join.");
  }
}

ui.connectButton.addEventListener("click", async () => {
  ui.connectButton.disabled = true;
  ui.connectStatus.textContent = "Connecting to the local Colyseus server...";
  try {
    const check = await client.create(CONNECTION_ROOM, {
      protocolVersion: PROTOCOL_VERSION,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timed out waiting for authoritative server state.")),
        5_000,
      );
      check.onStateChange.once((state: unknown) => {
        window.clearTimeout(timer);
        if (isConnectionState(state)) {
          resolve();
        } else {
          reject(new Error("Server returned an incompatible connection snapshot."));
        }
      });
      check.onError((code, message) => {
        window.clearTimeout(timer);
        reject(new Error(
          typeof code === "number"
            ? `Server error ${code}${message ? `: ${message}` : ""}`
            : "The connection to the server failed",
        ));
      });
      check.onLeave((code) => {
        window.clearTimeout(timer);
        reject(new Error(`Server closed the connection (${code}).`));
      });
    }).finally(() => check.leave());
    ui.connectStatus.textContent = `Connected: shared protocol v${PROTOCOL_VERSION}, authoritative lobby state received.`;
  } catch (error) {
    console.error("Connection check failed", error);
    ui.connectStatus.textContent =
      `Connection failed: ${error instanceof Error ? error.message : String(error)}. Check the server terminal and network.`;
  } finally {
    ui.connectButton.disabled = false;
  }
});
