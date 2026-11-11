import { useCallback, useEffect, useState } from "react";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import { fetchSnapshot } from "./api";

export type PollState = "loading" | "ok" | "error";

export interface PollResult {
  snapshot: FactorySnapshot | null;
  state: PollState;
  lastFetchAt: number | null;
  refetch: () => void;
}

/** Poll `GET /api/snapshot` every `intervalMs` (default ~5s). */
export function useSnapshotPoll(intervalMs = 5000): PollResult {
  const [snapshot, setSnapshot] = useState<FactorySnapshot | null>(null);
  const [state, setState] = useState<PollState>("loading");
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    try {
      const snap = await fetchSnapshot();
      setSnapshot(snap);
      setState("ok");
      setLastFetchAt(Date.now());
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), intervalMs);
    return () => clearInterval(id);
  }, [refetch, intervalMs]);

  return { snapshot, state, lastFetchAt, refetch };
}
