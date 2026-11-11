# M3-followup spec: /factory board pipeline flow strip

**Status:** Draft — for builder execution. · **Workstream:** factory control center (M3 TUI follow-up)
**Sources:** [M3 spec](factory-control-tui.md), user request (boxes + arrows showing stage flow), [brainstorm](factory-control-brainstorm.md).

## Goal

Make the `/factory` board visually communicate the pipeline: a **horizontal,
boxed flow strip** at the top of the board showing the eight stages in order
(`Spec → Dispatch → Execute → Review → QA → Integrate → CI → Done`), each stage
as a box with its title and live unit count, connected by arrows, wrapping
cleanly on narrow terminals. The existing scrollable card columns below are
unchanged.

## Scope (in)

- `factory-control/tui/src/render.ts`: new pure renderer `renderPipelineStrip(model, style, width)` returning boxed stage boxes joined by `→`.
- `factory-control/tui/src/selectors.ts`: expose whatever the strip needs from `BoardModel` (stage title + unit count per column; already present via `STAGE_COLUMNS`/`ColumnModel`).
- `factory-control/tui/src/render.test.ts` (or a new `pipeline.test.ts`): unit tests asserting exact lines for a fixture board, including wrap at a narrow width.
- Keep `renderBoardBody` and card/column behavior unchanged.

## Out of scope

- Changing navigation, selection, or the card model.
- Changing `Unknown`/`Orphaned` treatment (they remain below, not part of the flow strip).
- Web mirror, server, actions, dispatch — TUI rendering only.

## Design

- Boxes use box-drawing characters (`┌─┐ │ └─┘`), consistent with the existing `─` divider use.
- Each box: `┌───────┐` / `│ Spec  │` / `│  (1)  │` / `└───────┘` (title padded, count centered).
- Between boxes: ` → ` (with surrounding spaces) on the same row.
- **Wrap rule:** append boxes left-to-right; if adding the next box would exceed `width`, end the current row and continue on the next line (the sequence continues left-to-right, no trailing marker required). Strip must never exceed `width` per line (use `truncateToWidth` safety).
- Styling via `LineStyle` seam: `accent(bold(title))` for the title, `muted(count)` for the count; borders use `muted`. `plainStyle` yields identical strings for tests.
- The strip is rendered as the first lines of the board view (above `renderBoardBody` output); if the board has no columns (empty snapshot), render a single dim "no units" strip.

## Acceptance criteria

1. The board shows a boxed flow strip: eight boxes in `Spec → Dispatch → Execute → Review → QA → Integrate → CI → Done` order, each with title and live unit count.
2. Boxes are joined with `→`; the strip wraps to additional lines on a narrow width and every line fits `width`.
3. `Unknown`/`Orphaned` are not in the strip (unchanged below).
4. Card columns/navigation below are byte-identical to today (no behavior change).
5. New unit tests cover: exact strip lines for a fixture board (titles, counts, arrows, borders); wrap behavior at narrow widths; empty-board strip.
6. `npm run check` passes (tui + server + web suites green).

## Validation

Inside the worktree: `npm run typecheck`, `npm test` (tui suite incl. new strip tests), `npm run build`, `npm run check`, and (if feasible) a quick `pi -e …` render smoke to eyeball the strip. Report actual outputs.

## Handoff

Builder reports: files changed, renderer implementation, wrap algorithm, tests added, before/after sample render at a couple widths, risks, remaining work, three-way reconciliation.
