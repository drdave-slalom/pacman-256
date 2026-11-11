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

/** Inline GitHub mark (octocat silhouette) — no external/binary asset. */
function GitHubMark() {
  return (
    <svg className="github-mark" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8 0 3.54-2.29 6.53-5.47 7.59.4-.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
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
        {unit.issue ? (
          <span className="chip chip-source" title="GitHub issue">
            <GitHubMark />
          </span>
        ) : null}
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
