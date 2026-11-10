import type { Client, Room } from "@colyseus/sdk";
import {
  DISPLAY_NAME_MAX_LENGTH,
  GAME_ROOM,
  PROTOCOL_VERSION,
  describeJoinError,
  isValidDisplayName,
  parseAppRoute,
  serializeAppRoute,
} from "@maze/shared";
import type { AppRoute } from "@maze/shared";

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

interface LobbyOptions {
  client: Client;
  onEnterGame: () => void;
  onLeaveGame: () => void;
}

interface ErrorDetail {
  code?: unknown;
  message?: unknown;
}

function errorDetail(error: unknown): ErrorDetail {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (code === undefined) {
      return { message: error.message };
    }
    return { code, message: error.message };
  }
  return { message: String(error) };
}

/**
 * Wire the lobby screen (display name, create/join, prototype fallback).
 *
 * T3 integration seam: create/join target the shared `GAME_ROOM` constant and
 * send the contract payload (`protocolVersion` + `displayName`; room code on
 * join). When the server accepts, `enterRoom` fires `onEnterGame`, which shows
 * the game area. Until the server registers `GAME_ROOM`, create/join reject and
 * the mapped error is shown; the local prototype maze stays available via
 * "Enter prototype maze".
 */
export function initLobby(options: LobbyOptions): void {
  const { client, onEnterGame, onLeaveGame } = options;

  const nameInput = document.querySelector<HTMLInputElement>("#display-name");
  const roomCodeInput = document.querySelector<HTMLInputElement>("#room-code");
  const createButton = document.querySelector<HTMLButtonElement>("#create-room");
  const joinButton = document.querySelector<HTMLButtonElement>("#join-room");
  const localPlayButton = document.querySelector<HTMLButtonElement>("#local-play");
  const leaveButton = document.querySelector<HTMLButtonElement>("#leave-game");
  const lobbyStatus = document.querySelector<HTMLParagraphElement>("#lobby-status");

  if (
    !nameInput ||
    !roomCodeInput ||
    !createButton ||
    !joinButton ||
    !localPlayButton ||
    !leaveButton ||
    !lobbyStatus
  ) {
    throw new Error("Lobby controls are required.");
  }

  // Single-source the display-name limit: derive the input attribute from the
  // shared constant so the HTML maxlength cannot drift.
  nameInput.maxLength = DISPLAY_NAME_MAX_LENGTH;

  let activeRoom: Room | null = null;

  const setStatus = (message: string): void => {
    lobbyStatus.textContent = message;
  };

  const validNameOrStatus = (): string | null => {
    if (!isValidDisplayName(nameInput.value)) {
      setStatus(
        "Enter a display name (1–16 characters, no control characters).",
      );
      nameInput.focus();
      return null;
    }
    return nameInput.value.trim();
  };

  const resetActiveRoom = (): void => {
    if (activeRoom !== null) {
      try {
        activeRoom.leave();
      } catch {
        // Leaving a room is best-effort; nothing further to do.
      }
      activeRoom = null;
    }
  };

  const setJoining = (joining: boolean): void => {
    createButton.disabled = joining;
    joinButton.disabled = joining;
    // Disable the prototype fallback while a create/join is in flight so a
    // late resolve/reject cannot apply over the prototype state (M3).
    localPlayButton.disabled = joining;
  };

  const enterRoom = async (room: Room, verb: string): Promise<void> => {
    activeRoom = room;
    room.onError((code, message) => {
      setStatus(describeJoinError(code, message));
    });
    room.onLeave(() => {
      if (activeRoom === room) {
        activeRoom = null;
      }
    });
    setStatus(`Joined room ${room.roomId} (${verb}). Game rendering lands with T3.`);
    setRouteHash({ view: "room", code: room.roomId });
    onEnterGame();
  };

  const runJoin = async (
    name: string,
    action: () => Promise<Room>,
    verb: string,
  ): Promise<void> => {
    rememberDisplayName(name);
    setJoining(true);
    try {
      const room = await action();
      await enterRoom(room, verb);
    } catch (error) {
      const detail = errorDetail(error);
      setStatus(describeJoinError(detail.code, detail.message));
    } finally {
      setJoining(false);
    }
  };

  const enterPrototype = (): void => {
    // Local prototype: no server room involved. Drop any stale room so the
    // fallback never claims a server match.
    resetActiveRoom();
    const name = nameInput.value.trim();
    if (isValidDisplayName(name)) {
      rememberDisplayName(name);
    }
    setStatus("Prototype maze (local, offline). Create/join use the server once T3 lands.");
    setRouteHash({ view: "prototype" });
    onEnterGame();
  };

  createButton.addEventListener("click", () => {
    const name = validNameOrStatus();
    if (name === null) {
      return;
    }
    void runJoin(
      name,
      () =>
        client.create(GAME_ROOM, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: name,
        }),
      "created",
    );
  });

  joinButton.addEventListener("click", () => {
    const code = roomCodeInput.value.trim();
    if (code.length === 0) {
      setStatus("Enter a room code to join.");
      roomCodeInput.focus();
      return;
    }
    const name = validNameOrStatus();
    if (name === null) {
      return;
    }
    void runJoin(
      name,
      () =>
        client.joinById(code, {
          protocolVersion: PROTOCOL_VERSION,
          displayName: name,
        }),
      "joined",
    );
  });

  localPlayButton.addEventListener("click", enterPrototype);

  leaveButton.addEventListener("click", () => {
    resetActiveRoom();
    setRouteHash({ view: "lobby" });
    onLeaveGame();
  });

  // Restore any saved display name so a refresh can rejoin a room.
  const savedName = savedDisplayName();
  if (savedName && isValidDisplayName(savedName)) {
    nameInput.value = savedName;
  }

  // Restore the view from the URL hash: prototype maze or a joined room.
  const initialRoute = parseAppRoute(window.location.hash);
  if (initialRoute.view === "prototype") {
    enterPrototype();
  } else if (initialRoute.view === "room") {
    roomCodeInput.value = initialRoute.code;
    const name =
      savedName && isValidDisplayName(savedName) ? savedName.trim() : null;
    if (name !== null) {
      setStatus(`Attempting to rejoin room ${initialRoute.code}…`);
      void runJoin(
        name,
        () =>
          client.joinById(initialRoute.code, {
            protocolVersion: PROTOCOL_VERSION,
            displayName: name,
          }),
        "rejoined",
      );
    } else {
      setStatus("Enter your display name to rejoin your room.");
      nameInput.focus();
    }
  }
}
