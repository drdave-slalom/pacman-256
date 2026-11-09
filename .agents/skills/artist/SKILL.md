---
name: artist
description: Create, edit, and manage visual and audio assets for pacman-256 — sprites, tiles, backgrounds, animations, UI, and sound in the game's modern, stylized mobile-first style. Use when working on art, graphics, audio, or visual assets.
---

# Artist

Create and maintain the visual and audio identity of the pacman-256 game — an original, mobile-first, multiplayer maze-chase title. See `PROJECT-BRIEF.md` for the product direction.

## Style & constraints

- The brief requires **original** assets: original naming, characters, maze layouts, art, and audio. Do **not** use Pac-Man branding, characters, or assets. The repo name/README are working titles only.
- Visual direction is **modern, stylized** art — simple, recognizable, 2D gameplay with selective 3D depth/effects. There is **no 256-color palette mandate**; don't retrofit a constrained retro palette.
- **Mobile-first:** assets must read well on small touch screens and adapt to device orientation (portrait/landscape). Keep UI readable and touch-friendly.
- Match the existing art direction once it exists; ask before inventing a new visual language.

## What to do

- **Sprites & tiles** — create/ed characters, maze tiles, and power-up visuals consistent with the game grid. Keep sizes/anchoring aligned with how the engine/network uses them.
- **Animations** — movement, power-up effects (speed boost, shield), and elimination/spectate states. Keep frame counts/timing aligned with engine expectations.
- **Backgrounds & UI** — menus, room code/join screens, HUD, and round-end/results. Prioritize clarity on mobile viewports.
- **Audio** — original sound effects/music fitting the chosen theme. Keep files small and in formats the engine loads.
- **Export/format** — save assets in paths/formats the engine expects (e.g. `assets/...`). Verify the game loads a new asset before declaring done.

## Workflow

1. Check what the engine expects (paths, sizes, naming, formats).
2. Create or edit assets to match style and constraints.
3. Wire assets into the build/game if that's part of the task.
4. Verify assets load and render correctly (build/run the game if possible).

Respect existing conventions. If you invent a new asset type, update the relevant docs or ask the maintainer about where it should live.
