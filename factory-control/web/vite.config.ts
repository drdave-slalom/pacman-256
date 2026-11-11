import { defineConfig } from "vite";

/**
 * M1 web mirror development configuration.
 *
 * Production serving is handled by the factory-control server (static build,
 * same-origin `/api/*`). The Vite dev server is a convenience for iterating
 * on the UI: it proxies `/api` to a running control server.
 *
 * Bind defaults: `HOST`/`PORT` (127.0.0.1:4173). For LAN team access, run
 * with `HOST=0.0.0.0` — documented as a trust decision in the factory-control
 * README.
 */
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const apiTarget = process.env.FACTORY_API_TARGET ?? "http://127.0.0.1:4780";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host,
    port,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
