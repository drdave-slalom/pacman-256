import type { FactorySnapshot } from "@maze/factory-control-shared";
import type { PreconditionLike, PlanLike } from "./state/actions";

const SNAPSHOT_PATH = "/api/snapshot";
const ACTION_BASE = "/api/actions";
const TIMEOUT_MS = 6000;

/**
 * Snapshot fetch. The web mirror reads the snapshot from the control server;
 * mutations only ever go through the guarded M2 action API below.
 */
export async function fetchSnapshot(): Promise<FactorySnapshot> {
  return requestJson<FactorySnapshot>(SNAPSHOT_PATH, {
    headers: { accept: "application/json" },
  });
}

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

/**
 * `POST /api/actions/<name>/prepare` — evaluate gate preconditions for an
 * action. Returns the requestId + plan; nothing runs yet.
 */
export function prepareAction(name: string, req: Record<string, unknown>): Promise<PrepareResponse> {
  return requestJson<PrepareResponse>(`${ACTION_BASE}/${encodeURIComponent(name)}/prepare`, {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * `POST /api/actions/<name>/execute` — confirm a prepared request. 409
 * responses (guard preconditions / lock) surface as `ApiError` with the exact
 * guard reasons.
 */
export function executeAction(name: string, req: Record<string, unknown>): Promise<ActionResultLike> {
  return requestJson<ActionResultLike>(`${ACTION_BASE}/${encodeURIComponent(name)}/execute`, {
    method: "POST",
    body: JSON.stringify(req),
  });
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
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
