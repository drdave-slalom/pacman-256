import type { FactorySnapshot } from "@maze/factory-control-shared";
import { formatDiff, showBranch, suggestNextAction, unitById } from "../state/selectors";
import { Link } from "../router";
import { ActionBadges } from "./ActionBadges";

function CheckLabel({ checks }: { checks: string }) {
  if (checks === "green") return <span className="checks checks-green">✓ green</span>;
  if (checks === "red") return <span className="checks checks-red">✗ red</span>;
  if (checks === "pending") return <span className="checks checks-pending">… pending</span>;
  return <span className="checks checks-none">{checks}</span>;
}

export function UnitDetail({ snapshot, id }: { snapshot: FactorySnapshot; id: string }) {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return (
      <main className="detail">
        <p className="empty">Unknown unit “{id}”.</p>
        <Link to="/" className="back">← Back to board</Link>
      </main>
    );
  }

  const action = suggestNextAction(unit);

  return (
    <main className="detail" data-testid="unit-detail">
      <div className="detail-head">
        <Link to="/" className="back">← Board</Link>
        <h1>{unit.title ?? unit.id}</h1>
        {unit.lane ? <span className="lane">{unit.lane}</span> : <span className="lane lane-muted">no lane</span>}
        <span className="stage-pill">stage {unit.stage}</span>
      </div>

      <section className="panel">
        <h2>Spec</h2>
        <p className="goal">{unit.goal ?? "No goal listed."}</p>
        {unit.parseError ? <p className="parse-error">spec parse error: {unit.parseError}</p> : null}
        <p className="muted">spec: {unit.specPath ?? "—"}</p>
      </section>

      <section className="panel">
        <h2>Git</h2>
        <dl className="kv">
          <dt>branch</dt><dd>{unit.branch ? <code>{`@${showBranch(unit.branch)}`}</code> : <span className="muted">none</span>}</dd>
          <dt>worktree</dt><dd>{unit.worktree ? <code>{unit.worktree.path}</code> : <span className="muted">none</span>}</dd>
          <dt>dirty</dt><dd>{unit.worktree ? (unit.worktree.dirty ? "yes" : "no") : <span className="muted">—</span>}</dd>
          <dt>diff</dt><dd>{unit.worktree?.diff ? <code>{formatDiff(unit.worktree.diff)}</code> : <span className="muted">—</span>}</dd>
        </dl>
      </section>

      <section className="panel">
        <h2>Pull request & checks</h2>
        {unit.pr ? (
          <dl className="kv">
            <dt>PR</dt>
            <dd><a href={unit.pr.url} target="_blank" rel="noreferrer">{`#${unit.pr.number}`} <span className="muted">({unit.pr.state})</span></a></dd>
            <dt>checks</dt>
            <dd><CheckLabel checks={unit.pr.checks} /></dd>
          </dl>
        ) : (
          <p className="muted">No pull request attached.</p>
        )}
      </section>

      <section className="panel">
        <h2>Handoff trail</h2>
        {unit.handoffs.length === 0 ? (
          <p className="muted">No handoffs recorded.</p>
        ) : (
          <ol className="trail">
            {unit.handoffs.map((handoff, i) => (
              <li key={i} className="trail-item">
                <span className="trail-def">{handoff.definition ?? "unknown definition"}</span>
                <span className="trail-agent">{handoff.agent ?? "unknown agent"}</span>
                {handoff.sessionId ? <code className="trail-ref">{handoff.sessionId}</code> : null}
                {handoff.excerpt ? <p className="trail-excerpt">{handoff.excerpt}</p> : null}
                <span className="muted">{handoff.source}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel">
        <h2>Attention & suggested next action</h2>
        <ActionBadges attention={unit.attention} />
        <div className="next-action">
          <div>
            <span className="next-label">{action.label}</span>
            <span className="muted">{action.note} — display-only</span>
          </div>
        </div>
      </section>
    </main>
  );
}
