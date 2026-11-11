import type { FactorySnapshot } from "@maze/factory-control-shared";
import { buildBoard, totalOrphaned } from "../state/selectors";
import { UnitCard } from "./UnitCard";

export function Board({ snapshot }: { snapshot: FactorySnapshot }) {
  const board = buildBoard(snapshot);
  return (
    <main className="board" data-testid="board">
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
      </div>
    </main>
  );
}
