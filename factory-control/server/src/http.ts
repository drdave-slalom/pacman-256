import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { defaultWebRoot, serveStatic } from "./static.ts";
import type { SnapshotService } from "./service.ts";
import { ActionsService } from "./actions/actions.ts";
import type { ExecuteRequest, ExecuteMeta, PrepareMeta, PrepareRequest } from "./actions/types.ts";
import { checkControlToken, clientIp } from "./actions/token.ts";

const MAX_BODY_BYTES = 64 * 1024;

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

function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** `POST /api/actions/<name>/(prepare|execute)` — name may contain `/`. */
const ACTION_ROUTE = /^\/api\/actions\/(.+)\/(prepare|execute)$/;

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  service: SnapshotService,
  webRoot: string,
  actions: ActionsService,
): Promise<void> {
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

  // Guarded action API (M2). The web mirror never calls these endpoints; the
  // operator TUI is the only client.
  const actionMatch = ACTION_ROUTE.exec(path);
  if (method === "POST" && actionMatch !== null && actionMatch[1] !== undefined && actionMatch[2] !== undefined) {
    let name: string;
    try {
      name = decodeURIComponent(actionMatch[1]);
    } catch {
      sendJson(res, 400, { error: "malformed action name" });
      return;
    }
    const phase = actionMatch[2];
    const token = checkControlToken(req);
    if (!token.ok) {
      sendJson(res, token.status, { error: token.error });
      return;
    }
    const body = await readJsonBody(req);
    if (body === null || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    if (phase === "prepare") {
      const prepareMeta: PrepareMeta = {};
      const ip = clientIp(req);
      if (ip !== undefined) prepareMeta.ip = ip;
      const outcome = await actions.prepare(name, body as PrepareRequest, prepareMeta);
      if (outcome.kind === "unknown-action") {
        sendJson(res, 404, { error: "unknown action" });
        return;
      }
      if (outcome.kind === "invalid-input") {
        sendJson(res, 400, { error: outcome.error });
        return;
      }
      sendJson(res, 200, {
        requestId: outcome.requestId,
        ok: outcome.ok,
        preconditions: outcome.preconditions,
        plan: outcome.plan,
      });
      return;
    }
    const executeMeta: ExecuteMeta = {};
    const ip = clientIp(req);
    if (ip !== undefined) executeMeta.ip = ip;
    const outcome = await actions.execute((body as ExecuteRequest).requestId ?? "", body as ExecuteRequest, executeMeta);
    if (outcome.kind === "no-prepare") {
      sendJson(res, 409, { error: "no matching prepare", preconditions: [] });
      return;
    }
    if (outcome.kind === "no-confirm") {
      sendJson(res, 400, { error: "confirm: true required" });
      return;
    }
    if (outcome.kind === "preconditions") {
      sendJson(res, 409, { error: "preconditions failed", preconditions: outcome.preconditions });
      return;
    }
    if (outcome.kind === "lock") {
      sendJson(res, 409, { error: "lock held", preconditions: outcome.preconditions });
      return;
    }
    sendJson(res, 200, outcome.result);
    return;
  }

  if (method === "GET" && path === "/api/actions/audit") {
    const token = checkControlToken(req);
    if (!token.ok) {
      sendJson(res, token.status, { error: token.error });
      return;
    }
    const raw = url.searchParams.get("limit");
    const limit = raw !== null && /^\d+$/.test(raw) ? Math.min(1000, Number.parseInt(raw, 10)) : 200;
    sendJson(res, 200, { audit: actions.recentAudit(limit) });
    return;
  }

  if (method === "GET" && path === "/api/actions/locks") {
    const token = checkControlToken(req);
    if (!token.ok) {
      sendJson(res, token.status, { error: token.error });
      return;
    }
    const locks = actions.locksList().map((lock) => ({
      unit: lock.unit,
      requestId: lock.requestId,
      operator: lock.operator,
      acquiredAt: lock.acquiredAt,
      pid: lock.pid,
      stale: actions.lockStale(lock),
    }));
    sendJson(res, 200, { locks });
    return;
  }

  // Read-only API: every other method/path is 404.
  sendJson(res, 404, { error: "not found" });
}

/**
 * Create the factory-control HTTP server: read-only snapshot API, the guarded
 * action API (M2), and static hosting of the built web mirror. `webRoot`
 * defaults to the built app under the factory root (`FACTORY_ROOT` or CWD).
 * `actions` may be injected (tests); by default one is built over the
 * snapshot service.
 */
export function createApiServer(
  service: SnapshotService,
  opts: { webRoot?: string; actions?: ActionsService } = {},
): Server {
  const factoryRoot = process.env.FACTORY_ROOT ?? process.cwd();
  const webRoot = opts.webRoot ?? defaultWebRoot(factoryRoot);
  const actions =
    opts.actions ??
    new ActionsService({
      snapshot: () => service.get(),
      factoryRoot,
    });
  return createServer((req, res) => {
    void route(req, res, service, webRoot, actions);
  });
}
