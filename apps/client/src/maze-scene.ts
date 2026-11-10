import Phaser from "phaser";
import { MAZE_HEIGHT, MAZE_WIDTH, generateMaze, isWalkableIn } from "@maze/shared";
import type { Direction, GameRoomSnapshot, PlayerTeam } from "@maze/shared";
import { Interpolator, mazeKey, playerViews } from "./session-model.ts";

export const TILE_SIZE = 32;
const SWIPE_THRESHOLD = 14;
const PLAYER_RADIUS = TILE_SIZE * 0.35;
/**
 * The local player gets a thick pulsing white ring well outside its circle.
 * The canvas is scaled to roughly half size on a 390px-wide phone, so the
 * ring is sized to stay several screen pixels wide there.
 */
const LOCAL_RING_RADIUS = PLAYER_RADIUS + 7;
const LOCAL_RING_WIDTH = 5;

const TEAM_COLORS: Readonly<Record<PlayerTeam, number>> = {
  hunter: 0xff6b4a,
  runner: 0x4ad8ff,
  unassigned: 0x9aa3b5,
};

/** What the scene reads each frame; the network session owns the data. */
export interface MazeSceneSource {
  snapshot(): GameRoomSnapshot | null;
  localPlayerId(): string;
  /** Called on a steering intent; the caller dedupes and sends. */
  steer(direction: Direction): void;
}

function dominantAxis(offset: { x: number; y: number }): Direction | null {
  if (Math.abs(offset.x) < SWIPE_THRESHOLD && Math.abs(offset.y) < SWIPE_THRESHOLD) {
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

/**
 * Renders the server-authoritative round: the maze from the server's seed and
 * every player interpolated between patches. Input only reports intent; the
 * scene never moves players itself.
 */
export class MazeScene extends Phaser.Scene {
  private source!: MazeSceneSource;
  private mazeGraphics!: Phaser.GameObjects.Graphics;
  private renderedMazeKey: string | null = null;
  private lastRevision = -1;
  private readonly interpolator = new Interpolator();
  private readonly circles = new Map<string, Phaser.GameObjects.Arc>();
  private localRing!: Phaser.GameObjects.Arc;
  private dragPointerId: number | null = null;
  private dragAccum = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };

  constructor() {
    super("maze");
  }

  init(source: MazeSceneSource): void {
    this.source = source;
  }

  create(): void {
    this.mazeGraphics = this.add.graphics();
    this.localRing = this.add.circle(0, 0, LOCAL_RING_RADIUS);
    this.localRing.setStrokeStyle(LOCAL_RING_WIDTH, 0xffffff, 1);
    this.localRing.setDepth(12).setVisible(false);
    this.tweens.add({
      targets: this.localRing,
      scale: { from: 1, to: 1.25 },
      alpha: { from: 1, to: 0.55 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
    this.setupSwipeSteering();
    this.setupKeyboardSteering();
  }

  update(): void {
    const snapshot = this.source.snapshot();
    const key = snapshot ? mazeKey(snapshot) : null;
    if (!snapshot || key === null) {
      return;
    }
    if (key !== this.renderedMazeKey) {
      this.renderedMazeKey = key;
      this.renderMaze(generateMaze(snapshot.mazeSeed));
      this.interpolator.clear();
      this.lastRevision = -1;
    }
    const now = this.time.now;
    const views = playerViews(snapshot, this.source.localPlayerId());
    if (snapshot.revision !== this.lastRevision) {
      this.lastRevision = snapshot.revision;
      this.interpolator.update(views, now);
    }
    const present = new Set<string>();
    let localShown = false;
    for (const view of views) {
      present.add(view.id);
      const position = this.interpolator.sample(view.id, now) ?? view;
      let circle = this.circles.get(view.id);
      if (!circle) {
        circle = this.add.circle(0, 0, PLAYER_RADIUS, TEAM_COLORS[view.team]);
        circle.setDepth(view.isLocal ? 11 : 10);
        if (view.isLocal) {
          circle.setStrokeStyle(3, 0xffffff, 1);
        }
        this.circles.set(view.id, circle);
      }
      circle.setFillStyle(TEAM_COLORS[view.team]);
      circle.setPosition(position.x * TILE_SIZE, position.y * TILE_SIZE);
      if (view.isLocal) {
        this.localRing.setPosition(circle.x, circle.y);
        localShown = true;
      }
    }
    this.localRing.setVisible(localShown);
    for (const [id, circle] of this.circles) {
      if (!present.has(id)) {
        circle.destroy();
        this.circles.delete(id);
      }
    }
  }

  private renderMaze(maze: readonly string[]): void {
    const tiles = this.mazeGraphics;
    tiles.clear();
    // Near-black background; corridors stay darker than the wall zones.
    tiles.fillStyle(0x05060a, 1);
    tiles.fillRect(0, 0, MAZE_WIDTH * TILE_SIZE, MAZE_HEIGHT * TILE_SIZE);
    // Subtle dark-blue tint behind wall cells so wall masses read distinctly
    // from the black corridors.
    tiles.fillStyle(0x0b1224, 1);
    for (let row = 0; row < MAZE_HEIGHT; row++) {
      for (let col = 0; col < MAZE_WIDTH; col++) {
        if (!isWalkableIn(maze, col, row)) {
          tiles.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Neon line art: a glowing stroke runs along every floor/wall boundary
    // (soft outer halos then a hot bright core).
    const segments: Array<[number, number, number, number]> = [];
    for (let row = 0; row < MAZE_HEIGHT; row++) {
      for (let col = 0; col < MAZE_WIDTH; col++) {
        if (!isWalkableIn(maze, col, row)) {
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
          if (!isWalkableIn(maze, col + dx, row + dy)) {
            segments.push([x1, y1, x2, y2]);
          }
        };
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
      if (pointer.pointerId !== this.dragPointerId || !isTouchPointer(pointer)) {
        return;
      }
      // Phaser's pointer.movementX/Y are only populated while the mouse is
      // pointer-locked, so compute deltas from the pointer's own coordinates.
      this.dragAccum.x += pointer.x - this.dragLast.x;
      this.dragAccum.y += pointer.y - this.dragLast.y;
      this.dragLast = { x: pointer.x, y: pointer.y };
      const steer = dominantAxis(this.dragAccum);
      if (steer) {
        this.source.steer(steer);
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
      // Key-repeat "down" events repeat the same direction; the sender dedupes them.
      keys[key].on("down", () => this.source.steer(direction));
    }
  }
}
