/**
 * Control-server client for the factory-control TUI.
 *
 * Talks to the local factory-control server (M0 snapshot + M2 guarded action
 * API). Read-only (`GET /api/snapshot`, `GET /api/healthz`) plus the M2
 * prepare/execute protocol. Never mutates anything except through the M2
 * endpoints.
 */

import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { PreconditionLike, PlanLike } from "./actions.ts";

export interface PrepareResponse {
  requestId: string;
  ok: boolean;
  preconditions: PreconditionLike[];
  plan: PlanLike;
}

export interface ActionResultLike {
  outcome: "success" | "failed";
  command: string[];
  exit: number | null;
  outputTail: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly preconditions: PreconditionLike[];

  constructor(status: number, message: string, preconditions: PreconditionLike[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.preconditions = preconditions;
  }
}

const TIMEOUT_MS = 6000;

export function controlBaseUrl(): string {
  const raw = process.env.FACTORY_CONTROL_URL ?? "http://127.0.0.1:4780";
  return raw.replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env.FACTORY_CONTROL_TOKEN;
  return token !== undefined && token !== "" ? { "X-Control-Token": token } : {};
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(controlBaseUrl() + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const obj = (body ?? {}) as { error?: string; preconditions?: PreconditionLike[] };
    throw new ApiError(res.status, obj.error ?? `HTTP ${res.status}`, obj.preconditions ?? []);
  }
  return body as T;
}

export function fetchSnapshot(signal?: AbortSignal): Promise<FactorySnapshot> {
  const init: RequestInit = {};
  if (signal !== undefined) init.signal = signal;
  return requestJson<FactorySnapshot>("/api/snapshot", init);
}

export async function healthz(): Promise<boolean> {
  try {
    await requestJson<{ ok: boolean }>("/api/healthz");
    return true;
  } catch {
    return false;
  }
}

export function prepareAction(name: string, body: Record<string, unknown>): Promise<PrepareResponse> {
  return requestJson<PrepareResponse>(`/api/actions/${encodeURIComponent(name)}/prepare`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function executeAction(name: string, requestId: string, approvedBy?: string): Promise<ActionResultLike> {
  const body: Record<string, unknown> = { requestId, confirm: true };
  if (approvedBy !== undefined && approvedBy !== "") body.approvedBy = approvedBy;
  return requestJson<ActionResultLike>(`/api/actions/${encodeURIComponent(name)}/execute`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
