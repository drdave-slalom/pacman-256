import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { SnapshotService } from "./service.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function route(req: IncomingMessage, res: ServerResponse, service: SnapshotService): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const path = url.pathname;

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

/** Create the read-only factory-control HTTP API. */
export function createApiServer(service: SnapshotService): Server {
  return createServer((req, res) => route(req, res, service));
}
