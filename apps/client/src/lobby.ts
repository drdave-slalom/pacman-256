import type { Client, Room } from "@colyseus/sdk";
import {
  DISPLAY_NAME_MAX_LENGTH,
  GAME_ROOM,
  PROTOCOL_VERSION,
  describeJoinError,
  isValidDisplayName,
} from "@maze/shared";

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
    onEnterGame();
  };

  const runJoin = async (
    name: string,
    action: () => Promise<Room>,
    verb: string,
  ): Promise<void> => {
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

  localPlayButton.addEventListener("click", () => {
    // Local prototype: no server room involved. Drop any stale room so the
    // fallback never claims a server match.
    resetActiveRoom();
    setStatus("Prototype maze (local, offline). Create/join use the server once T3 lands.");
    onEnterGame();
  });

  leaveButton.addEventListener("click", () => {
    resetActiveRoom();
    onLeaveGame();
  });
}
