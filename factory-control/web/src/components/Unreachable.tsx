export function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="unreachable" data-testid="unreachable">
      <div className="panel">
        <h1>Control server not reachable</h1>
        <p>
          The web mirror could not load <code>/api/snapshot</code>. Start the factory-control
          server (<code>npm run factory:control:serve</code>) or check the bind address / network.
        </p>
        <button type="button" className="retry" onClick={onRetry}>Retry</button>
      </div>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="unreachable">
      <div className="panel">
        <h1>Page not found</h1>
        <p>The requested mirror page does not exist.</p>
      </div>
    </main>
  );
}
