/**
 * M2 operator-session token.
 *
 * A `X-Control-Token` header gates the action endpoints for remote operator
 * sessions. It is optional on localhost; when the server binds a non-loopback
 * address, a matching configured token (`FACTORY_CONTROL_TOKEN`) is required.
 * If no token is configured, remote action sessions are denied entirely.
 */

import type { IncomingMessage } from "node:http";
import { controlToken } from "../config.ts";

export function clientIp(req: IncomingMessage): string | undefined {
  const addr = req.socket.remoteAddress;
  if (addr === undefined) return undefined;
  return addr.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
}

export function isLoopback(req: IncomingMessage): boolean {
  const ip = clientIp(req);
  return ip === "127.0.0.1" || ip === "::1";
}

export type TokenCheck = { ok: true } | { ok: false; status: number; error: string };

export function checkControlToken(req: IncomingMessage): TokenCheck {
  if (isLoopback(req)) return { ok: true };
  const token = controlToken();
  if (token === undefined) {
    return {
      ok: false,
      status: 503,
      error: "control token not configured; remote action sessions are disabled",
    };
  }
  const header = req.headers["x-control-token"];
  if (typeof header === "string" && header === token) return { ok: true };
  return { ok: false, status: 401, error: "invalid or missing control token" };
}
