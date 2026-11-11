/**
 * factory-control TUI extension (M3) — entry point.
 *
 * Registers `/factory` (and `/factory <query>` to filter the board) which
 * opens the custom Factory screen via `ctx.ui.custom()`. Load this extension
 * through pi's extension loader (see `factory-control/tui/README.md`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FactoryScreen } from "./screen.ts";

export default function factoryControlTui(pi: ExtensionAPI): void {
  pi.registerCommand("factory", {
    description: "Open the factory control screen (board, detail, actions, agents)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("factory requires interactive TUI mode", "error");
        return;
      }
      await ctx.ui.custom<void>((tui, theme, kb, done) => {
        return new FactoryScreen({ tui, theme, kb, done, ctx, query: args?.trim() ?? "" });
      });
    },
  });
}
