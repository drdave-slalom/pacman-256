import type { CheckState, Unit } from "@maze/factory-control-shared";
import { formatDiff, issueStatusLabel, showBranch } from "../state/selectors";
import { Link } from "../router";
import { ActionBadges } from "./ActionBadges";

function CheckIcon({ checks }: { checks: CheckState }) {
  if (checks === "green") return <span className="check check-green" title="checks green">✓</span>;
  if (checks === "red") return <span className="check check-red" title="checks red">✗</span>;
  if (checks === "pending") return <span className="check check-pending" title="checks pending">…</span>;
  return <span className="check check-none" title="no checks">·</span>;
}

export function UnitCard({ unit }: { unit: Unit }) {
  return (
    <Link to={`/unit/${encodeURIComponent(unit.id)}`} className="card">
      <div className="card-top">
        <span className="card-id">{unit.id}</span>
        {unit.lane ? <span className="lane">{unit.lane}</span> : null}
      </div>
      {unit.title ? <h3 className="card-title">{unit.title}</h3> : null}
      <div className="chips">
        {unit.issue ? <span className="chip chip-issue">{`#${unit.issue.number}`}</span> : null}
        {unit.issue ? <span className="chip chip-status">{issueStatusLabel(unit.issue)}</span> : null}
        {unit.issue?.labels.blocked ? <span className="chip chip-blocked" title="issue blocked">⛔ blocked</span> : null}
        {unit.branch ? <span className="chip chip-branch">{`@${showBranch(unit.branch)}`}</span> : null}
        {unit.agents.map((agent) => (
          <span key={agent.label} className="chip chip-agent" title={agent.definition}>
            {agent.label}
          </span>
        ))}
        {unit.pr ? (
          <span className="chip chip-pr">
            {`PR #${unit.pr.number}`} <CheckIcon checks={unit.pr.checks} />
          </span>
        ) : null}
        {unit.worktree?.diff ? <span className="chip chip-diff">{formatDiff(unit.worktree.diff)}</span> : null}
        {unit.worktree?.dirty ? <span className="chip chip-dirty" title="dirty worktree">● dirty</span> : null}
      </div>
      <ActionBadges attention={unit.attention} />
    </Link>
  );
}
