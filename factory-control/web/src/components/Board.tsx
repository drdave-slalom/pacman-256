import { useState } from "react";
import type { FactorySnapshot } from "@maze/factory-control-shared";
import { buildBoard, closedUnmatchedIssues, issueStatusLabel, totalOrphaned } from "../state/selectors";
import { UnitCard } from "./UnitCard";

/**
 * Presentational board (controlled by the `showClosed` toggle). Extracted so
 * tests can render the ON/OFF states directly; the interactive `Board`
 * wrapper owns the toggle state.
 */
export function BoardContent({
  snapshot,
  showClosed,
  onToggleShowClosed,
}: {
  snapshot: FactorySnapshot;
  showClosed: boolean;
  onToggleShowClosed: () => void;
}) {
  const board = buildBoard(snapshot);
  const closed = showClosed ? closedUnmatchedIssues(snapshot) : [];
  return (
    <main className="board" data-testid="board">
      <div className="board-toolbar">
        <label className="toolbar-toggle">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={onToggleShowClosed}
            aria-label="Show closed issues"
          />
          Show closed issues
        </label>
      </div>
      <div className="board-scroll">
        {board.columns.map((column) => (
          <section key={column.key} className={`column column-${column.key}`}>
            <header className="column-head">
              <h2>{column.title}</h2>
              <span className="count">{column.units.length}</span>
            </header>
            <div className="column-body">
              {column.units.length === 0 ? <p className="empty">no units</p> : column.units.map((unit) => <UnitCard key={unit.id} unit={unit} />)}
            </div>
          </section>
        ))}
        <section className="column column-orphaned">
          <header className="column-head">
            <h2>Orphaned</h2>
            <span className="count">{totalOrphaned(board)}</span>
          </header>
          <div className="column-body">
            {board.orphaned.branches.map((branch) => <p key={`b:${branch}`} className="orphan-item">branch {branch}</p>)}
            {board.orphaned.worktrees.map((path) => <p key={`w:${path}`} className="orphan-item">worktree {path}</p>)}
            {board.orphaned.prs.map((pr) => <p key={`p:${pr.number}`} className="orphan-item">PR #{pr.number} ({pr.headRefName})</p>)}
            {board.orphaned.handoffs.map((ho, i) => <p key={`h:${i}`} className="orphan-item">handoff {ho.agent ?? "?"} · {ho.definition ?? "?"}</p>)}
            {totalOrphaned(board) === 0 ? <p className="empty">none</p> : null}
          </div>
        </section>
        {closed.length > 0 ? (
          <section className="column column-issues">
            <header className="column-head">
              <h2>Closed issues</h2>
              <span className="count">{closed.length}</span>
            </header>
            <div className="column-body">
              {closed.map((issue) => (
                <p key={`ci:${issue.number}`} className="closed-issue-item">
                  <a href={issue.url} target="_blank" rel="noreferrer" className="closed-issue-link">
                    #{issue.number} {issue.title}
                  </a>
                  <span className="chip chip-status">{issueStatusLabel(issue)}</span>
                </p>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export function Board({ snapshot }: { snapshot: FactorySnapshot }) {
  const [showClosed, setShowClosed] = useState(false);
  return (
    <BoardContent
      snapshot={snapshot}
      showClosed={showClosed}
      onToggleShowClosed={() => setShowClosed((value) => !value)}
    />
  );
}
