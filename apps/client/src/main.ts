import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";
import {
  CLIENT_MESSAGES,
  CONNECTION_ROOM,
  GAME_ROOM,
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
  StartMatchMessage,
  Team,
} from "@maze/shared";
import { MazeScene, TILE_SIZE } from "./maze-scene.ts";
import type { MazeSceneSource } from "./maze-scene.ts";
import {
  DirectionSender,
  PendingAction,
  isPlausibleRoomCode,
  isRoundActive,
  leaveMessage,
  playerViews,
} from "./session-model.ts";
import type { ActionOutcome } from "./session-model.ts";
import "./style.css";

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
  lobbyHint: element<HTMLElement>("#lobby-hint"),
  lobbyNotice: element<HTMLElement>("#lobby-notice"),
  gamePanel: element<HTMLElement>("#game-panel"),
  gameMount: element<HTMLElement>("#game"),
  gameStatus: element<HTMLElement>("#game-status"),
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
 * Input outside an active round is dropped; the sender dedupes, sequences, and
 * budgets it.
 */
function sendDirection(direction: Direction): void {
  if (!room || !snapshot || !isRoundActive(snapshot)) {
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
    if (!room || !snapshot || !isRoundActive(snapshot)) {
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
  showView("join");
}

function sendAction(
  type: "chooseTeam" | "startMatch",
  payload: (requestId: string) => ChooseTeamMessage | StartMatchMessage,
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
    showMessage(errorMessage(outcome.code));
  } else {
    showMessage("The server did not answer in time. Try again.");
  }
}

function setLobbyBusy(busy: boolean): void {
  ui.hunterButton.disabled = busy;
  ui.runnerButton.disabled = busy;
  ui.startButton.disabled = busy;
}

const TEAM_LABELS = { hunter: "Hunters", runner: "Runners", unassigned: "no team yet" } as const;

function render(): void {
  if (!room || !snapshot) {
    return;
  }
  const localId = room.sessionId;
  const players = playerViews(snapshot, localId);
  const local = players.find((player) => player.isLocal);
  if (isRoundActive(snapshot)) {
    showView("game");
    const status =
      `Room ${snapshot.roomCode} · ${players.length} players · team: ${local ? TEAM_LABELS[local.team] : "not in round"} · you: pulsing white ring`;
    // A live region: rewriting identical text at patch rate would re-announce it.
    if (ui.gameStatus.textContent !== status) {
      ui.gameStatus.textContent = status;
    }
    return;
  }
  showView("lobby");
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
  ui.startButton.hidden = !isHost;
  ui.lobbyHint.textContent = snapshot.phase !== "lobby"
    ? `Room phase: ${snapshot.phase}.`
    : isHost
      ? "Pick teams, then start when hunters and runners are balanced (1v1 or 2v2)."
      : "Pick a team. The host starts the match.";
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
