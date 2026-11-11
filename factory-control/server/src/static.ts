import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

/**
 * Static file serving for the factory-control web mirror (M1).
 *
 * The control server owns the assembled snapshot API *and* hosts the built
 * Vite app (`factory-control/web/dist`). This module is strictly additive and
 * read-only: it only maps GET/HEAD requests (outside `/api/`) to files under
 * the web root, with an SPA fallback to `index.html` for extension-less
 * routes. Mutating methods are intentionally not handled here — the HTTP
 * router answers them with 404/405.
 */

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

export const INDEX_NAME = "index.html";

/** Default location of the built web app, given a factory repo root. */
export function defaultWebRoot(factoryRoot: string): string {
  return resolve(factoryRoot, "factory-control", "web", "dist");
}

function contentTypeOf(file: string): string {
  return MIME[extname(file)] ?? "application/octet-stream";
}

function sendText(res: ServerResponse, status: number, body: string): void {
  const payload = Buffer.from(body, "utf-8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(payload.byteLength),
  });
  res.end(payload);
}

function sendFile(res: ServerResponse, file: string, head: boolean): void {
  const size = statSync(file).size;
  res.writeHead(200, {
    "content-type": contentTypeOf(file),
    "content-length": String(size),
    "cache-control": "public, max-age=0, must-revalidate",
  });
  if (head) {
    // HEAD: headers only, no body.
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/**
 * Resolve a URL path to an absolute file path inside `webRoot`, or `null`
 * when the path escapes the web root (traversal).
 */
export function webFilePath(webRoot: string, urlPath: string): string | null {
  const root = resolve(webRoot);
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  } catch {
    return null; // malformed percent-encoding
  }
  if (rel === "") rel = INDEX_NAME;
  const candidate = resolve(root, rel);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/**
 * Serve a static file for a GET/HEAD request. Returns `true` when the
 * request was fully handled (including the SPA fallback / 404); `false`
 * when the caller should decide (non-GET methods).
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, webRoot: string): boolean {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return false;

  let path: string;
  try {
    path = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    sendText(res, 400, "bad request");
    return true;
  }

  const file = webFilePath(webRoot, path);
  const head = method === "HEAD";
  if (file === null) {
    sendText(res, 404, "not found");
    return true;
  }
  try {
    if (existsSync(file) && statSync(file).isFile()) {
      sendFile(res, file, head);
      return true;
    }
  } catch {
    // fall through to SPA fallback / 404
  }

  // SPA fallback: extension-less routes (kanban, unit detail, agents) are
  // served by the app shell. Asset-like paths that do not exist are 404.
  const index = resolve(webRoot, INDEX_NAME);
  if (extname(path) === "" && existsSync(index) && statSync(index).isFile()) {
    sendFile(res, index, head);
    return true;
  }
  sendText(res, 404, "not found");
  return true;
}
