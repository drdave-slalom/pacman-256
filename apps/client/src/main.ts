import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import {
  CONNECTION_ROOM,
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  MAZE_HEIGHT,
  MAZE_MAP,
  MAZE_WIDTH,
  PROTOCOL_VERSION,
  createPlayerMoveState,
  findSpawnCell,
  generateMaze,
  isConnectionState,
  isWalkableIn,
  stepPlayerMove,
} from "@maze/shared";
import type { Direction } from "@maze/shared";
import { initLobby } from "./lobby";
import "./style.css";

const TILE_SIZE = 32;
const SWIPE_THRESHOLD = 14;

// Set by MazeScene once it is created; the HTML D-pad buttons below the canvas
// call this to steer, so the arrows never overlay the maze.
let steerFromDpad: ((direction: Direction) => void) | null = null;

// True only while the game area is visible. Keyboard steering is ignored in the
// lobby so hardware-keyboard typing in the lobby inputs is never swallowed.
let gameAreaActive = false;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const gameContainer = requiredElement<HTMLElement>("#game");
const lobbyEl = requiredElement<HTMLElement>("#lobby");
const gameEl = requiredElement<HTMLElement>("#game-area");
const connectButton = requiredElement<HTMLButtonElement>("#connect");
const statusText = requiredElement<HTMLParagraphElement>("#status");
const displayNameEl = requiredElement<HTMLInputElement>("#display-name");
const seedText = document.querySelector<HTMLParagraphElement>("#seed");

// The game surface must not scroll or zoom while controlling it.
gameContainer.addEventListener("touchmove", (event) => event.preventDefault(), {
  passive: false,
});
gameContainer.addEventListener("contextmenu", (event) => event.preventDefault());

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target.closest("input, textarea, select") !== null;
}

function dominantAxis(offset: { x: number; y: number }): Direction | null {
  if (
    Math.abs(offset.x) < SWIPE_THRESHOLD &&
    Math.abs(offset.y) < SWIPE_THRESHOLD
  ) {
    return null;
  }
  if (Math.abs(offset.x) > Math.abs(offset.y)) {
    return offset.x > 0 ? "right" : "left";
  }
  return offset.y > 0 ? "down" : "up";
}

interface KeyboardSteerKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
}

const KEY_TO_DIRECTION: Array<{ key: keyof KeyboardSteerKeys; direction: Direction }> = [
  { key: "up", direction: "up" },
  { key: "w", direction: "up" },
  { key: "down", direction: "down" },
  { key: "s", direction: "down" },
  { key: "left", direction: "left" },
  { key: "a", direction: "left" },
  { key: "right", direction: "right" },
  { key: "d", direction: "right" },
];

class MazeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private maze: readonly string[] = MAZE_MAP;
  private playerState = createPlayerMoveState();
  private dragPointerId: number | null = null;
  private dragAccum = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };

  constructor() {
    super("maze-scene");
  }

  create(): void {
    const seed = (Math.random() * 0x100000000) >>> 0;
    this.maze = generateMaze(seed);
    const spawn = findSpawnCell(this.maze);
    this.playerState = createPlayerMoveState(spawn);
    this.renderMaze();
    this.createPlayer(spawn);
    this.setupSwipeSteering();
    this.setupKeyboardSteering();
    steerFromDpad = (direction) => this.queueMovement(direction);
    if (seedText) {
      seedText.textContent = `Maze seed ${seed}`;
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.playerState = stepPlayerMove(
      this.playerState,
      DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
      dt,
      this.maze,
    );
    this.player.setPosition(
      this.playerState.position.x * TILE_SIZE,
      this.playerState.position.y * TILE_SIZE,
    );
  }

  private renderMaze(): void {
    const tiles = this.add.graphics();
    // Near-black background; corridors stay darker than the wall zones.
    tiles.fillStyle(0x05060a, 1);
    tiles.fillRect(0, 0, MAZE_WIDTH * TILE_SIZE, MAZE_HEIGHT * TILE_SIZE);
    // Subtle dark-blue tint behind wall cells so wall masses read distinctly
    // from the black corridors.
    tiles.fillStyle(0x0b1224, 1);
    for (let row = 0; row < MAZE_HEIGHT; row++) {
      for (let col = 0; col < MAZE_WIDTH; col++) {
        if (!isWalkableIn(this.maze, col, row)) {
          tiles.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Neon line art, like the reference maze: a glowing stroke runs along
    // every floor/wall boundary (soft outer halos then a hot bright core).
    const segments: Array<[number, number, number, number]> = [];
    for (let row = 0; row < MAZE_HEIGHT; row++) {
      for (let col = 0; col < MAZE_WIDTH; col++) {
        if (!isWalkableIn(this.maze, col, row)) {
          continue;
        }
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const boundary = (
          dx: number,
          dy: number,
          x1: number,
          y1: number,
          x2: number,
          y2: number,
        ) => {
          if (!isWalkableIn(this.maze, col + dx, row + dy)) {
            segments.push([x1, y1, x2, y2]);
          }
        }
        boundary(-1, 0, x, y, x, y + TILE_SIZE);
        boundary(1, 0, x + TILE_SIZE, y, x + TILE_SIZE, y + TILE_SIZE);
        boundary(0, -1, x, y, x + TILE_SIZE, y);
        boundary(0, 1, x, y + TILE_SIZE, x + TILE_SIZE, y + TILE_SIZE);
      }
    }
    const passes: Array<[number, number, number]> = [
      [7, 0.09, 0x4fc3ff],
      [4.5, 0.16, 0x4fc3ff],
      [2.5, 0.95, 0x8ae4ff],
      [1, 1, 0xe2f7ff],
    ];
    for (const [width, alpha, color] of passes) {
      tiles.lineStyle(width, color, alpha);
      for (const [x1, y1, x2, y2] of segments) {
        tiles.lineBetween(x1, y1, x2, y2);
      }
    }
  }

  private createPlayer(spawn: { col: number; row: number }): void {
    const px = (spawn.col + 0.5) * TILE_SIZE;
    const py = (spawn.row + 0.5) * TILE_SIZE;
    this.player = this.add.circle(px, py, TILE_SIZE * 0.35, 0xff9de2);
    this.player.setDepth(10);
  }

  private setupSwipeSteering(): void {
    const isTouchPointer = (pointer: Phaser.Input.Pointer): boolean => {
      const event = pointer.event as Partial<PointerEvent> | undefined;
      if (event?.pointerType) {
        return event.pointerType === "touch";
      }
      if (event?.type) {
        return event.type.startsWith("touch");
      }
      // Pointer Events spec: the mouse pointer id is always 0; touch ids are
      // browser-assigned and non-zero.
      return pointer.pointerId !== 0;
    };

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      // Swipe steering is touch-only; the mouse never steers the player.
      if (!isTouchPointer(pointer)) {
        return;
      }
      this.dragPointerId = pointer.pointerId;
      this.dragAccum = { x: 0, y: 0 };
      this.dragLast = { x: pointer.x, y: pointer.y };
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.pointerId !== this.dragPointerId) {
        return;
      }
      if (!isTouchPointer(pointer)) {
        return;
      }
      // Phaser's pointer.movementX/Y are only populated while the mouse is
      // pointer-locked, so compute deltas from the pointer's own coordinates.
      this.dragAccum.x += pointer.x - this.dragLast.x;
      this.dragAccum.y += pointer.y - this.dragLast.y;
      this.dragLast = { x: pointer.x, y: pointer.y };
      const steer = dominantAxis(this.dragAccum);
      if (steer) {
        this.queueMovement(steer);
        this.dragAccum = { x: 0, y: 0 };
      }
    });

    const endDrag = (pointer: Phaser.Input.Pointer) => {
      if (pointer.pointerId === this.dragPointerId) {
        this.dragPointerId = null;
        this.dragAccum = { x: 0, y: 0 };
      }
    };
    this.input.on("pointerup", endDrag);
    this.input.on("pointercancel", endDrag);
  }

  private setupKeyboardSteering(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }
    // enableCapture=false: Phaser must not call preventDefault on these keys
    // globally, or typing WASD/arrow keys in the lobby inputs would swallow
    // keystrokes on hardware-keyboard devices. Steering is filtered below to
    // the active game area and non-typing targets.
    const keys = keyboard.addKeys(
      {
        up: "UP",
        down: "DOWN",
        left: "LEFT",
        right: "RIGHT",
        w: "W",
        s: "S",
        a: "A",
        d: "D",
      },
      false,
    ) as KeyboardSteerKeys;
    for (const { key, direction } of KEY_TO_DIRECTION) {
      keys[key].on(
        "down",
        (keyEvent: Phaser.Input.Keyboard.Key, event: KeyboardEvent) => {
          if (
            !gameAreaActive ||
            isTypingTarget(event.target) ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.metaKey
          ) {
            return;
          }
          event.preventDefault();
          this.queueMovement(direction);
        },
      );
    }
  }

  private queueMovement(direction: Direction): void {
    this.playerState = { ...this.playerState, queuedDirection: direction };
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: MAZE_WIDTH * TILE_SIZE,
  height: MAZE_HEIGHT * TILE_SIZE,
  backgroundColor: "#05060a",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: MazeScene,
});

// The maze prototype is hosted inside the game area, which starts hidden behind
// the lobby. Entering it regenerates a fresh maze and starts the scene.
function enterGameArea(): void {
  gameAreaActive = true;
  lobbyEl.hidden = true;
  gameEl.hidden = false;
  const scene = game.scene.getScene("maze-scene") as MazeScene;
  scene.scene.resume();
  scene.scene.restart();
  game.scale.refresh();
  const firstDpadButton = document.querySelector<HTMLButtonElement>(
    "#dpad button[data-direction]",
  );
  firstDpadButton?.focus();
}

function leaveGameArea(): void {
  gameAreaActive = false;
  gameEl.hidden = true;
  lobbyEl.hidden = false;
  const scene = game.scene.getScene("maze-scene") as MazeScene;
  scene.scene.pause();
  displayNameEl.focus();
}

// Wire the HTML D-pad below the canvas. The pad lives outside the Phaser
// canvas, so it never covers the maze; swipes on the maze itself still work.
const dpadButtons = document.querySelectorAll<HTMLButtonElement>(
  "#dpad button[data-direction]",
);
for (const button of dpadButtons) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const direction = button.dataset.direction as Direction;
    steerFromDpad?.(direction);
  });
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

// In dev, the Vite dev server proxies /multiplayer to the backend and strips
// the prefix. When the built client is served by the game server itself
// (production/Kubernetes), Colyseus's matchmaking and room routes live at the
// document root, so connect there directly.
const endpoint = new URL(
  import.meta.env.PROD ? "/" : "/multiplayer",
  window.location.href,
);
endpoint.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const client = new Client(endpoint.toString());

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  statusText.textContent = "Connecting to the local Colyseus server...";
  try {
    const room = await client.create(CONNECTION_ROOM, {
      protocolVersion: PROTOCOL_VERSION,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Timed out waiting for authoritative server state.")),
        5_000,
      );
      room.onStateChange.once((state: unknown) => {
        window.clearTimeout(timer);
        if (isConnectionState(state)) {
          resolve();
        } else {
          reject(new Error("Server returned an incompatible connection snapshot."));
        }
      });
      room.onError((code, message) => {
        window.clearTimeout(timer);
        reject(new Error(`Server error ${code}: ${message}`));
      });
      room.onLeave((code) => {
        window.clearTimeout(timer);
        reject(new Error(`Server closed the connection (${code}).`));
      });
    }).finally(() => room.leave());
    statusText.textContent = `Connected: shared protocol v${PROTOCOL_VERSION}, authoritative lobby state received.`;
  } catch (error) {
    console.error("Connection check failed", error);
    statusText.textContent =
      `Connection failed: ${error instanceof Error ? error.message : String(error)}. Check the server terminal and network.`;
  } finally {
    connectButton.disabled = false;
  }
});

initLobby({
  client,
  onEnterGame: enterGameArea,
  onLeaveGame: leaveGameArea,
});
