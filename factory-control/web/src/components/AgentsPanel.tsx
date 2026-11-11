import type { FactorySnapshot } from "@maze/factory-control-shared";
import { formatElapsed, LIFECYCLE_META } from "../state/selectors";

export function AgentsPanel({ snapshot }: { snapshot: FactorySnapshot }) {
  return (
    <main className="agents" data-testid="agents">
      <h1>Herd</h1>
      <p className="muted">Mirror of live agent states — read-only, refreshes on poll.</p>
      {snapshot.agents.length === 0 ? (
        <p className="empty">No agents in the herd.</p>
      ) : (
        <ul className="agent-list">
          {snapshot.agents.map((agent) => {
            const meta = LIFECYCLE_META[agent.state];
            return (
              <li key={agent.label} className={`agent-row${agent.stale ? " is-stale" : ""}`}>
                <span className={`glyph lifecycle-${agent.state}`} title={agent.state} aria-label={meta.label}>
                  {meta.glyph}
                </span>
                <div className="agent-main">
                  <div className="agent-line">
                    <strong>{agent.label}</strong>
                    <span className="chip chip-agent">{agent.definition}</span>
                    <span className={`agent-state state-${agent.state}`}>{meta.label}</span>
                  </div>
                  <div className="agent-meta">
                    <span className="agent-elapsed">{formatElapsed(agent.elapsedMs)}</span>
                    {agent.model ? <span className="agent-model">{agent.model}</span> : null}
                    {agent.thinking ? <span className="chip chip-thinking">thinking</span> : null}
                    {agent.contextPct !== undefined ? <span className="agent-ctx">{`${agent.contextPct}% ctx`}</span> : null}
                    {agent.stale ? <span className="chip chip-stale">stale</span> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
