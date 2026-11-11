import type { FactorySnapshot } from "@maze/factory-control-shared";

const SNAPSHOT_PATH = "/api/snapshot";
const TIMEOUT_MS = 4000;

/**
 * Read-only snapshot fetch. The web mirror never writes: this is the only
 * network call the app makes.
 */
export async function fetchSnapshot(): Promise<FactorySnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SNAPSHOT_PATH, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`snapshot request failed: ${res.status}`);
    return (await res.json()) as FactorySnapshot;
  } finally {
    clearTimeout(timer);
  }
}
