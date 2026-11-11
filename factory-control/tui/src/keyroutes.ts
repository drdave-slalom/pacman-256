/**
 * Keyboard routing for the factory-control TUI.
 *
 * A pure decision table: given the raw input and a keybinding matcher
 * (the `KeybindingsManager` from pi at runtime, a stub in tests), invoke the
 * right screen operation. This keeps "keybinding handling" unit-testable
 * without a live TUI.
 */

export interface KeyMatcher {
  matches(binding: string): boolean;
}

export interface FactoryScreenOps {
  moveSelection(delta: number): void;
  pageSelection(delta: number): void;
  openSelected(): void;
  openAgents(): void;
  openActions(): void;
  back(): void;
  refresh(): void;
  close(): void;
  startServer(): void;
  openQueue(): void;
  copyLeadPrompt(): void;
  toggleClosedIssues(): void;
}

export function handleKey(data: string, kb: KeyMatcher, ops: FactoryScreenOps): void {
  if (kb.matches("tui.select.up")) {
    ops.moveSelection(-1);
    return;
  }
  if (kb.matches("tui.select.down")) {
    ops.moveSelection(1);
    return;
  }
  if (kb.matches("tui.select.pageUp")) {
    ops.pageSelection(-1);
    return;
  }
  if (kb.matches("tui.select.pageDown")) {
    ops.pageSelection(1);
    return;
  }
  if (kb.matches("tui.select.confirm")) {
    ops.openSelected();
    return;
  }
  if (kb.matches("tui.select.cancel")) {
    ops.back();
    return;
  }
  if (data === "a" || data === "A") {
    ops.openAgents();
    return;
  }
  if (data === "x" || data === "X") {
    ops.openActions();
    return;
  }
  if (data === "r" || data === "R") {
    ops.refresh();
    return;
  }
  if (data === "s" || data === "S") {
    ops.startServer();
    return;
  }
  if (data === "q" || data === "Q") {
    ops.openQueue();
    return;
  }
  if (data === "c" || data === "C") {
    ops.copyLeadPrompt();
    return;
  }
  if (data === "i" || data === "I") {
    ops.toggleClosedIssues();
    return;
  }
}
