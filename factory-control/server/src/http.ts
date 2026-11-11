import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { defaultWebRoot, serveStatic } from "./static.ts";
import type { SnapshotService } from "./service.ts";

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function route(req: IncomingMessage, res: ServerResponse, service: SnapshotService, webRoot: string): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (!path.startsWith("/api/")) {
    // Web mirror surface: read-only static app. Mutating methods are rejected
    // outright; GET/HEAD are served from the built web app (SPA fallback).
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "method not allowed", allow: "GET, HEAD" }, { allow: "GET, HEAD" });
      return;
    }
    serveStatic(req, res, webRoot);
    return;
  }

  if (method === "GET" && path === "/api/healthz") {
    sendJson(res, 200, { ok: true, snapshotAt: service.lastGeneratedAt() });
    return;
  }
  if (method === "GET" && path === "/api/snapshot") {
    void service.get().then(
      (snap) => sendJson(res, 200, snap),
      (error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }),
    );
    return;
  }
  if (method === "POST" && path === "/api/refresh") {
    void service.get(true).then(
      (snap) => sendJson(res, 200, snap),
      (error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }),
    );
    return;
  }

  // Read-only API: every other method/path is 404.
  sendJson(res, 404, { error: "not found" });
}

/**
 * Create the factory-control HTTP server: read-only snapshot API plus static
 * hosting of the built web mirror. `webRoot` defaults to the built app under
 * the factory root (`FACTORY_ROOT` or CWD).
 */
export function createApiServer(service: SnapshotService, opts: { webRoot?: string } = {}): Server {
  const factoryRoot = process.env.FACTORY_ROOT ?? process.cwd();
  const webRoot = opts.webRoot ?? defaultWebRoot(factoryRoot);
  return createServer((req, res) => route(req, res, service, webRoot));
}
