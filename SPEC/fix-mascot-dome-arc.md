# Fix ghost mascot dome arc (issue #63)

- **Issue:** #63 (review blocker from PR #24,
  https://github.com/drdave-slalom/pacman-256/pull/24#discussion_r4530748322)
- **Unit:** `mascot-dome-arc`
- **Branch:** `factory/mascot-dome-arc`
- **Decision:** D058 (recorded in `docs/DECISIONS.md`)

## Goal

Correct the client-side ghost mascot silhouette so the body dome caps the top of
the sprite and the eyes sit inside the colored body. The reviewer on PR #24
flagged the arc direction as a blocker; the PR merged without the fix.

## Root cause

`drawGhostBody()` in `apps/client/src/maze-scene.ts` draws the top dome with:

```ts
g.arc(0, 0, w, Math.PI, 0, true);
```

In Phaser's downward-positive Y coordinates, an anticlockwise arc from π to 0
passes through `(0, +radius)` — the **bottom** — so the body gets a lower
semicircle. The eyes are placed above center (`EYE_OFFSET_Y = -0.22 * radius`),
so they end up outside the colored body and the mascot has no upper dome.

## Scope

- Change the `g.arc(...)` call in `drawGhostBody()` to pass `anticlockwise: false`
  (last argument `false`) so the arc from π to 0 sweeps through `(0, -radius)`
  — the top — matching the intended domed silhouette.
- Keep the explanatory comment accurate.
- Add a short decision entry **D058** to `docs/DECISIONS.md` recording the
  approved dome direction and the PR #24 review resolution.

## Out of scope

- Any other rendering, asset, or gameplay changes.
- Changing eye/pupil geometry or any other constant.
- Server/shared packages.

## Assumptions

- The reviewer's geometry analysis is correct (verified: clockwise
  `anticlockwise: false` from π to 0 passes through `(0, -radius)` in Phaser's
  y-down coordinates).
- No pixel/snapshot test harness exists for the client draw path; validation is
  via `npm run check` plus geometry reasoning.

## Acceptance criteria

- AC1: `apps/client/src/maze-scene.ts` `drawGhostBody()` calls
  `g.arc(0, 0, w, Math.PI, 0, false)` (last argument `false`), with a comment
  explaining why.
- AC2: `docs/DECISIONS.md` gains a D058 entry summarizing the decision.
- AC3: `npm run check` passes in the worktree (typecheck, all tests, builds).
- AC4: The PR diff contains no unrelated changes (the only files touched are the
  two above, plus `SPEC/fix-mascot-dome-arc.md` and `.github/pull_request_template.md`-filled body).

## Validation

- In the worktree: `npm run check` (must exit 0).
- Visual reasoning: dome swept through `(0, -radius)`; eyes at `y = -0.22r`
  fall inside the dome.

## Handoff expectation

Return: files changed (paths), commands run with observed output, confirmation
each AC is met, and any residual risk.
