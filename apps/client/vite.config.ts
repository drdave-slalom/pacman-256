import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/multiplayer": {
        target: `http://127.0.0.1:${process.env.PORT ?? "2567"}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/multiplayer/, ""),
      },
    },
  },
});
