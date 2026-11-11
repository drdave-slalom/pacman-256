import type { FactorySnapshot } from "@maze/factory-control-shared";
import { formatAge, showBranch, summarize } from "../state/selectors";
import { Link } from "../router";
import type { PollState } from "../usePoll";

export function Header({
  snapshot,
  pollState,
  lastFetchAt,
  onRetry,
}: {
  snapshot: FactorySnapshot | null;
  pollState: PollState;
  lastFetchAt: number | null;
  onRetry: () => void;
}) {
  const summary = snapshot !== null ? summarize(snapshot) : null;
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Link to="/" className="brand">factory<span className="brand-dim">·control</span></Link>
        <span className="muted">mirror</span>
      </div>
      <nav className="topbar-nav">
        <Link to="/" className="navlink">Board</Link>
        <Link to="/agents" className="navlink">Agents</Link>
      </nav>
      <div className="topbar-meta">
        {summary ? (
          <>
            <span className="meta-chip" title="repo branch / dirty">
              <code>@{showBranch(snapshot!.repo.branch)}</code>
              {snapshot!.repo.dirty ? <span className="dirty-dot" title="dirty repo">●</span> : null}
            </span>
            <span className="meta-chip">{summary.units} units</span>
            <span className="meta-chip">{summary.acting} acting</span>
            <span className="meta-chip meta-blocked">{summary.blocked} blocked</span>
            {summary.errors > 0 ? <span className="meta-chip meta-errors">{summary.errors} errors</span> : null}
            {snapshot !== null ? (
              <span className="meta-chip meta-age" title={snapshot.generatedAt}>snapshot {formatAge(snapshot.generatedAt)}</span>
            ) : null}
          </>
        ) : null}
        {pollState === "error" ? (
          <button type="button" className="retry" onClick={onRetry}>retry</button>
        ) : lastFetchAt !== null ? (
          <span className="meta-chip meta-live" title={`last fetch ${new Date(lastFetchAt).toISOString()}`}>live</span>
        ) : (
          <span className="meta-chip">…</span>
        )}
      </div>
    </header>
  );
}
