import type { ReactNode } from "react";
import { usePath } from "./router";
import { useSnapshotPoll } from "./usePoll";
import { decodeUnitId } from "./path";
import { Board } from "./components/Board";
import { UnitDetail } from "./components/UnitDetail";
import { AgentsPanel } from "./components/AgentsPanel";
import { Header } from "./components/Header";
import { NotFound, Unreachable } from "./components/Unreachable";

const POLL_INTERVAL_MS = 5000;

export default function App() {
  const path = usePath();
  const { snapshot, state, lastFetchAt, refetch } = useSnapshotPoll(POLL_INTERVAL_MS);

  let page: ReactNode;
  if (state === "error" && snapshot === null) {
    page = <Unreachable onRetry={refetch} />;
  } else if (snapshot === null) {
    page = (
      <main className="loading">
        <p>Loading snapshot…</p>
      </main>
    );
  } else if (path === "/") {
    page = <Board snapshot={snapshot} />;
  } else if (path === "/agents") {
    page = <AgentsPanel snapshot={snapshot} />;
  } else if (path.startsWith("/unit/")) {
    const id = decodeUnitId(path.slice("/unit/".length));
    page = id === null ? <NotFound /> : <UnitDetail snapshot={snapshot} id={id} />;
  } else {
    page = <NotFound />;
  }

  return (
    <div className="app">
      <Header snapshot={snapshot} pollState={state} lastFetchAt={lastFetchAt} onRetry={refetch} />
      <div className="content">{page}</div>
    </div>
  );
}
