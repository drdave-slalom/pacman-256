import Phaser from "phaser";
import { MAZE_HEIGHT, MAZE_WIDTH, generateMaze, isWalkableIn } from "@maze/shared";
import type { Direction, GameRoomSnapshot, PlayerTeam } from "@maze/shared";
import { countdownRemaining } from "./hud-view.ts";
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
  hunter: 0xffd23f,
  runner: 0x3fe0ff,
  unassigned: 0x9aa3b5,
};

// Ghost-mascot geometry, expressed relative to PLAYER_RADIUS so the sprite
// scales with the tile size. The body is a domed top with scalloped feet; two
// eyes with pupils that glance toward the direction of travel.
const GHOST_FEET = 3;
const GHOST_FOOT_BASE = PLAYER_RADIUS * 1.0;
const GHOST_FOOT_NOTCH = PLAYER_RADIUS * 0.58;
const EYE_OFFSET_X = PLAYER_RADIUS * 0.42;
const EYE_OFFSET_Y = -PLAYER_RADIUS * 0.22;
const EYE_WHITE_RADIUS = PLAYER_RADIUS * 0.33;
const PUPIL_RADIUS = PLAYER_RADIUS * 0.17;
const PUPIL_SHIFT = PLAYER_RADIUS * 0.14;
const EYE_COLOR = 0xffffff;
const PUPIL_COLOR = 0x0b1224;

/** A player rendered as a ghost: body graphic, eye whites, and glancing pupils. */
interface Mascot {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  leftPupil: Phaser.GameObjects.Arc;
  rightPupil: Phaser.GameObjects.Arc;
  team: PlayerTeam;
  facing: { x: number; y: number };
  lastPos: { x: number; y: number } | null;
}

/**
 * Draws a classic ghost silhouette into `g`: a semicircular dome on top, flat
 * sides, and a scalloped bottom edge. Centered on the origin so the mascot's
 * container can be positioned directly at the player's tile coordinate.
 */
function drawGhostBody(
  g: Phaser.GameObjects.Graphics,
  color: number,
  radius: number,
  local: boolean,
): void {
  const w = radius;
  g.clear();
  g.fillStyle(color, 1);
  g.beginPath();
  // Top dome: a semicircle centered on the origin, sweeping over the top.
  g.arc(0, 0, w, Math.PI, 0, true);
  g.lineTo(w, GHOST_FOOT_BASE);
  // Scalloped feet, traced right to left back to the dome's left edge.
  const stepW = (2 * w) / GHOST_FEET;
  for (let i = 0; i < GHOST_FEET; i++) {
    const xRight = w - i * stepW;
    g.lineTo(xRight - stepW / 2, GHOST_FOOT_NOTCH);
    g.lineTo(xRight - stepW, GHOST_FOOT_BASE);
  }
  g.closePath();
  g.fillPath();
  if (local) {
    g.lineStyle(3, 0xffffff, 1);
    g.strokePath();
  }
}

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
  private readonly mascots = new Map<string, Mascot>();
  private localRing!: Phaser.GameObjects.Arc;
  private countdownText!: Phaser.GameObjects.Text;
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
    this.countdownText = this.add
      .text(0, 0, "", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "72px",
        color: "#eef4ff",
        stroke: "#05060a",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.countdownText.setPosition((MAZE_WIDTH * TILE_SIZE) / 2, (MAZE_HEIGHT * TILE_SIZE) / 2);
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
      let mascot = this.mascots.get(view.id);
      if (!mascot) {
        mascot = this.createMascot(view.team, view.isLocal);
        this.mascots.set(view.id, mascot);
      }
      if (mascot.team !== view.team) {
        mascot.team = view.team;
        drawGhostBody(mascot.body, TEAM_COLORS[view.team], PLAYER_RADIUS, view.isLocal);
      }
      const x = position.x * TILE_SIZE;
      const y = position.y * TILE_SIZE;
      this.updateFacing(mascot, x, y);
      mascot.container.setPosition(x, y);
      // Eliminated players keep rendering but dimmed (spectator view).
      mascot.container.setAlpha(view.alive ? 1 : 0.35);
      if (view.isLocal) {
        this.localRing.setPosition(x, y);
        localShown = view.alive;
      }
    }
    this.localRing.setVisible(localShown);
    if (snapshot.phase === "countdown") {
      this.countdownText.setText(String(countdownRemaining(snapshot))).setVisible(true);
    } else {
      this.countdownText.setVisible(false);
    }
    for (const [id, mascot] of this.mascots) {
      if (!present.has(id)) {
        mascot.container.destroy();
        this.mascots.delete(id);
      }
    }
  }

  /** Builds a ghost mascot: body graphic plus eye whites and glancing pupils. */
  private createMascot(team: PlayerTeam, isLocal: boolean): Mascot {
    const body = this.add.graphics();
    drawGhostBody(body, TEAM_COLORS[team], PLAYER_RADIUS, isLocal);
    const leftEye = this.add.circle(-EYE_OFFSET_X, EYE_OFFSET_Y, EYE_WHITE_RADIUS, EYE_COLOR);
    const rightEye = this.add.circle(EYE_OFFSET_X, EYE_OFFSET_Y, EYE_WHITE_RADIUS, EYE_COLOR);
    const leftPupil = this.add.circle(-EYE_OFFSET_X, EYE_OFFSET_Y, PUPIL_RADIUS, PUPIL_COLOR);
    const rightPupil = this.add.circle(EYE_OFFSET_X, EYE_OFFSET_Y, PUPIL_RADIUS, PUPIL_COLOR);
    const container = this.add.container(0, 0, [body, leftEye, rightEye, leftPupil, rightPupil]);
    container.setDepth(isLocal ? 11 : 10);
    return { container, body, leftPupil, rightPupil, team, facing: { x: 0, y: 1 }, lastPos: null };
  }

  /** Points the pupils along the mascot's recent travel; holds still when idle. */
  private updateFacing(mascot: Mascot, x: number, y: number): void {
    if (mascot.lastPos) {
      const dx = x - mascot.lastPos.x;
      const dy = y - mascot.lastPos.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        if (Math.abs(dx) > Math.abs(dy)) {
          mascot.facing = { x: Math.sign(dx), y: 0 };
        } else {
          mascot.facing = { x: 0, y: Math.sign(dy) };
        }
      }
    }
    mascot.lastPos = { x, y };
    const px = mascot.facing.x * PUPIL_SHIFT;
    const py = mascot.facing.y * PUPIL_SHIFT;
    mascot.leftPupil.setPosition(-EYE_OFFSET_X + px, EYE_OFFSET_Y + py);
    mascot.rightPupil.setPosition(EYE_OFFSET_X + px, EYE_OFFSET_Y + py);
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
