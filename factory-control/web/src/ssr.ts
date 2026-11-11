import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";
import { Board, BoardContent } from "./components/Board";
import { UnitCard } from "./components/UnitCard";
import { AgentsPanel } from "./components/AgentsPanel";
import { UnitDetail } from "./components/UnitDetail";
import { NotFound, Unreachable } from "./components/Unreachable";
import { decodeUnitId } from "./path";

/**
 * Server-side rendering entry used by the integration test to assert the real
 * components render from a fixture snapshot (no browser required).
 */
export function renderPage(snapshot: FactorySnapshot, path: string): string {
  const clean = path.split("?")[0] ?? "/";
  let element;
  if (clean === "/agents") {
    element = createElement(AgentsPanel, { snapshot });
  } else if (clean.startsWith("/unit/")) {
    const id = decodeUnitId(clean.slice("/unit/".length));
    element = id === null ? createElement(NotFound) : createElement(UnitDetail, { snapshot, id });
  } else {
    element = createElement(Board, { snapshot });
  }
  return renderToString(element);
}

/** Render the board with the show-closed toggle in a given state (test helper). */
export function renderBoardContent(snapshot: FactorySnapshot, showClosed: boolean): string {
  return renderToString(
    createElement(BoardContent, {
      snapshot,
      showClosed,
      onToggleShowClosed: () => {},
    }),
  );
}

/** Render a single unit card (used by the integration tests). */
export function renderUnitCard(unit: Unit): string {
  return renderToString(createElement(UnitCard, { unit }));
}

/** Render the friendly “control server not reachable” state. */
export function renderUnreachable(): string {
  return renderToString(createElement(Unreachable, { onRetry: () => {} }));
}
