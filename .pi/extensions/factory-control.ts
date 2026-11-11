/**
 * Project-local pi extension loader for the factory-control TUI (M3).
 *
 * pi auto-discovers `./.pi/extensions/` after the project is trusted. The
 * extension package lives in `factory-control/tui` (workspace
 * `@maze/factory-control-tui`); this shim just re-exports its default factory
 * so pi loads it as an extension. Run `npm install`/`npm ci` at the repo root
 * so the workspace symlink exists.
 */
import factoryExtension from "@maze/factory-control-tui";

export default factoryExtension;
