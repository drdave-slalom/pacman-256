import Phaser from "phaser";
import { Client } from "@colyseus/sdk";
import {
  CONNECTION_ROOM,
  DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
  MAZE_HEIGHT,
  MAZE_WIDTH,
  PLAYER_SPAWN,
  PROTOCOL_VERSION,
  createPlayerMoveState,
  isConnectionState,
  isWalkable,
  stepPlayerMove,
} from "@maze/shared";
import type { Direction } from "@maze/shared";
import "./style.css";

const TILE_SIZE = 32;
const SWIPE_THRESHOLD = 14;

const gameContainer = document.querySelector<HTMLElement>("#game");
const button = document.querySelector<HTMLButtonElement>("#connect");
const status = document.querySelector<HTMLParagraphElement>("#status");
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

class MazeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private playerState = createPlayerMoveState();
  private dragPointerId: number | null = null;
  private dragAccum = { x: 0, y: 0 };

  create(): void {
    this.renderMaze();
    this.createPlayer();
    this.setupSwipeSteering();
    this.setupDpad();
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.playerState = stepPlayerMove(
      this.playerState,
      DEFAULT_MOVE_SPEED_TILES_PER_SECOND,
      dt,
    );
    this.player.setPosition(
      this.playerState.position.x * TILE_SIZE,
      this.playerState.position.y * TILE_SIZE,
    );
  }

  private renderMaze(): void {
    const tiles = this.add.graphics();
    tiles.fillStyle(0x10172b, 1);
    tiles.fillRect(0, 0, MAZE_WIDTH * TILE_SIZE, MAZE_HEIGHT * TILE_SIZE);
    tiles.fillStyle(0x243658, 1);
    for (let row = 0; row < MAZE_HEIGHT; row++) {
      for (let col = 0; col < MAZE_WIDTH; col++) {
        if (!isWalkable(col, row)) {
          tiles.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  private createPlayer(): void {
    const px = (PLAYER_SPAWN.col + 0.5) * TILE_SIZE;
    const py = (PLAYER_SPAWN.row + 0.5) * TILE_SIZE;
    this.player = this.add.circle(px, py, TILE_SIZE * 0.35, 0x7be6d6);
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
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.pointerId !== this.dragPointerId) {
        return;
      }
      this.dragAccum.x += pointer.movementX;
      this.dragAccum.y += pointer.movementY;
      const steer = dominantAxis(this.dragAccum);
      if (steer) {
        this.queueMovement(steer);
        this.dragAccum = { x: 0, y: 0 };
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.pointerId === this.dragPointerId) {
        this.dragPointerId = null;
        this.dragAccum = { x: 0, y: 0 };
      }
    });
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

  private queueMovement(direction: Direction): void {
    this.playerState = { ...this.playerState, queuedDirection: direction };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: MAZE_WIDTH * TILE_SIZE,
  height: MAZE_HEIGHT * TILE_SIZE,
  backgroundColor: "#10172b",
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
