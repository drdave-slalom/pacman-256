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
import "./style.css";

const TILE_SIZE = 32;
const SWIPE_THRESHOLD = 14;

const gameContainer = document.querySelector<HTMLElement>("#game");
const button = document.querySelector<HTMLButtonElement>("#connect");
const status = document.querySelector<HTMLParagraphElement>("#status");
const seedText = document.querySelector<HTMLParagraphElement>("#seed");
if (!gameContainer || !button || !status) {
  throw new Error("The game mount, connect button and status element are required.");
}
const connectButton = button;
const statusText = status;

// The game surface must not scroll or zoom while controlling it.
gameContainer.addEventListener("touchmove", (event) => event.preventDefault(), {
  passive: false,
});
gameContainer.addEventListener("contextmenu", (event) => event.preventDefault());

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

  create(): void {
    const seed = (Math.random() * 0x100000000) >>> 0;
    this.maze = generateMaze(seed);
    const spawn = findSpawnCell(this.maze);
    this.playerState = createPlayerMoveState(spawn);
    this.renderMaze();
    this.createPlayer(spawn);
    this.setupSwipeSteering();
    this.setupDpad();
    this.setupKeyboardSteering();
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
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const overPad = this.input
        .hitTestPointer(pointer)
        .some((target) => target.getData("dpad") === true);
      if (overPad) {
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

  private setupDpad(): void {
    const size = 56;
    const gap = 6;
    const cx = this.scale.width - size * 1.65;
    const cy = this.scale.height - size * 1.65;
    const buttons: Array<{ direction: Direction; dx: number; dy: number }> = [
      { direction: "up", dx: 0, dy: -1 },
      { direction: "down", dx: 0, dy: 1 },
      { direction: "left", dx: -1, dy: 0 },
      { direction: "right", dx: 1, dy: 0 },
    ];

    for (const cfg of buttons) {
      const bx = cx + cfg.dx * (size + gap);
      const by = cy + cfg.dy * (size + gap);
      const pad = this.add
        .rectangle(bx, by, size, size, 0x2c4672, 0.85)
        .setStrokeStyle(2, 0x7be6d6, 0.8)
        .setInteractive()
        .setData("dpad", true)
        .setDepth(20);
      pad.on("pointerdown", () => this.queueMovement(cfg.direction));

      const arrow = this.add.graphics();
      const r = 12;
      arrow.fillStyle(0xeef4ff, 1);
      if (cfg.direction === "up") {
        arrow.fillTriangle(bx, by - r, bx - r, by + r * 0.9, bx + r, by + r * 0.9);
      } else if (cfg.direction === "down") {
        arrow.fillTriangle(bx, by + r, bx - r, by - r * 0.9, bx + r, by - r * 0.9);
      } else if (cfg.direction === "left") {
        arrow.fillTriangle(bx - r, by, bx + r * 0.9, by - r, bx + r * 0.9, by + r);
      } else {
        arrow.fillTriangle(bx + r, by, bx - r * 0.9, by - r, bx - r * 0.9, by + r);
      }
      arrow.setDepth(21);
    }
  }

  private setupKeyboardSteering(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }
    // enableCapture defaults to true, so Phaser calls preventDefault on the
    // handled keys (arrow keys would otherwise scroll the page).
    const keys = keyboard.addKeys({
      up: "UP",
      down: "DOWN",
      left: "LEFT",
      right: "RIGHT",
      w: "W",
      s: "S",
      a: "A",
      d: "D",
    }) as KeyboardSteerKeys;
    for (const { key, direction } of KEY_TO_DIRECTION) {
      keys[key].on("down", () => this.queueMovement(direction));
    }
  }

  private queueMovement(direction: Direction): void {
    this.playerState = { ...this.playerState, queuedDirection: direction };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: MAZE_WIDTH * TILE_SIZE,
  height: MAZE_HEIGHT * TILE_SIZE,
  backgroundColor: "#05060a",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: MazeScene,
});

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
