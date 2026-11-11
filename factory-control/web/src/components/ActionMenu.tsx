import { useEffect, useMemo, useState } from "react";
import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";
import {
  buildActionMenu,
  candidateActions,
  type ActionFormKind,
  type ActionMenuRow,
  type PreparedOutcome,
} from "../state/actions";
import { ApiError, executeAction, prepareAction } from "../api";

type ResultState =
  | { status: "idle" }
  | { status: "ok"; exit: number | null; commands: string[]; outputTail: string }
  | { status: "failed"; exit: number | null; commands: string[]; outputTail: string }
  | { status: "rejected"; reasons: string[] }
  | { status: "error"; message: string };

const EMPTY_INPUTS: Record<string, string> = {};

function defaultInputs(form: ActionFormKind | undefined, unit: Unit): Record<string, string> {
  if (form === "comment") return { body: "" };
  if (form === "labels") return { add: "", remove: "" };
  if (form === "state") return { state: unit.issue?.state ?? "open" };
  return EMPTY_INPUTS;
}

function formFilled(row: ActionMenuRow, inputs: Record<string, string>): boolean {
  if (row.form === undefined) return true;
  if (row.form === "comment") return (inputs.body ?? "").trim() !== "";
  if (row.form === "labels") return (inputs.add ?? "").trim() !== "" || (inputs.remove ?? "").trim() !== "";
  if (row.form === "state") return inputs.state === "open" || inputs.state === "closed";
  return true;
}

function splitLabels(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Guarded action menu for issue-backed units. Candidate actions are derived
 * from the unit's snapshot shape, then each is `prepare`d against the M2
 * server; accepted rows show their plan and a confirm → `execute` flow while
 * denied rows show the exact 409 guard reasons.
 */
export function ActionMenu({ unit, snapshot }: { unit: Unit; snapshot: FactorySnapshot }) {
  const candidates = useMemo(() => candidateActions(unit, snapshot), [unit, snapshot]);
  const [prepared, setPrepared] = useState<Map<string, PreparedOutcome>>(() => new Map());
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ResultState>>({});

  useEffect(() => {
    let cancelled = false;
    setPrepared(new Map());
    setInputs({});
    setResults({});

    void Promise.all(
      candidates.map(async (c) => {
        try {
          const res = await prepareAction(c.name, { unit: unit.id });
          if (cancelled) return;
          const outcome: PreparedOutcome = {
            ok: res.ok,
            preconditions: res.preconditions,
            plan: res.plan,
            requestId: res.requestId,
          };
          setPrepared((prev) => {
            const next = new Map(prev);
            next.set(c.name, outcome);
            return next;
          });
        } catch (err) {
          if (cancelled) return;
          const detail = err instanceof Error ? err.message : String(err);
          const precondition = { name: err instanceof ApiError && err.status === 409 ? "guard" : "api", ok: false, detail };
          const outcome: PreparedOutcome = { ok: false, preconditions: [precondition] };
          setPrepared((prev) => {
            const next = new Map(prev);
            next.set(c.name, outcome);
            return next;
          });
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [candidates, unit.id]);

  const rows = buildActionMenu(candidates, prepared);

  function setForm(name: string, patch: Record<string, string>) {
    setInputs((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), ...patch } }));
  }

  async function run(row: ActionMenuRow) {
    const outcome = prepared.get(row.name);
    if (outcome?.requestId === undefined || running !== null) return;
    setRunning(row.name);
    setResults((prev) => ({ ...prev, [row.name]: { status: "idle" } }));

    const body: Record<string, unknown> = { requestId: outcome.requestId, confirm: true };
    const values = inputs[row.name] ?? {};
    if (row.form === "comment") body.comment = (values.body ?? "").trim();
    if (row.form === "labels") {
      const add = splitLabels(values.add ?? "");
      const remove = splitLabels(values.remove ?? "");
      if (add.length > 0) body.addLabels = add;
      if (remove.length > 0) body.removeLabels = remove;
    }
    if (row.form === "state") body.state = values.state;

    try {
      const res = await executeAction(row.name, body);
      setResults((prev) => ({
        ...prev,
        [row.name]:
          res.outcome === "success"
            ? { status: "ok", exit: res.exit, commands: res.command, outputTail: res.outputTail }
            : { status: "failed", exit: res.exit, commands: res.command, outputTail: res.outputTail },
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const reasons = err.preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`);
        setResults((prev) => ({ ...prev, [row.name]: { status: "rejected", reasons } }));
      } else {
        setResults((prev) => ({ ...prev, [row.name]: { status: "error", message: err instanceof Error ? err.message : String(err) } }));
      }
    } finally {
      setRunning(null);
    }
  }

  if (rows.length === 0) {
    return <p className="muted">No actions available for this unit.</p>;
  }

  return (
    <div className="action-menu" data-testid="action-menu">
      {rows.map((row) => {
        const outcome = prepared.get(row.name);
        const checking = outcome === undefined;
        const values = inputs[row.name] ?? defaultInputs(row.form, unit);
        const result = results[row.name];
        const canRun = !checking && row.ok && row.requestId !== undefined && formFilled(row, values) && running === null;
        return (
          <div key={row.name} className="menu-row" data-testid={`action-row-${row.name}`}>
            <div className="menu-row-head">
              <strong className="menu-label">{row.label}</strong>
              <span className="muted">{row.hint}</span>
              {checking ? (
                <span className="menu-status menu-status-checking">checking…</span>
              ) : row.ok ? (
                <span className="menu-status menu-status-ready">ready</span>
              ) : (
                <span className="menu-status menu-status-denied">denied</span>
              )}
            </div>

            {!checking && !row.ok && row.reasons.length > 0 ? (
              <ul className="menu-reasons">
                {row.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}

            {row.plan !== undefined ? (
              <div className="menu-plan">
                <p className="menu-plan-summary">{row.plan.summary}</p>
                {row.plan.steps.map((step, i) => (
                  <code key={i} className="menu-plan-step">
                    {`${step.command} ${step.args.join(" ")}`}
                  </code>
                ))}
              </div>
            ) : null}

            {row.form !== undefined ? (
              <div className="menu-form">
                {row.form === "comment" ? (
                  <label className="form-field">
                    <span>Comment body</span>
                    <textarea
                      value={values.body ?? ""}
                      onChange={(e) => setForm(row.name, { body: e.target.value })}
                      rows={3}
                      placeholder="Markdown comment to post on the GitHub issue"
                    />
                  </label>
                ) : null}
                {row.form === "labels" ? (
                  <div className="form-row">
                    <label className="form-field">
                      <span>Add labels</span>
                      <input
                        value={values.add ?? ""}
                        onChange={(e) => setForm(row.name, { add: e.target.value })}
                        placeholder="bug, role:builder (comma-separated)"
                      />
                    </label>
                    <label className="form-field">
                      <span>Remove labels</span>
                      <input
                        value={values.remove ?? ""}
                        onChange={(e) => setForm(row.name, { remove: e.target.value })}
                        placeholder="blocked (comma-separated)"
                      />
                    </label>
                  </div>
                ) : null}
                {row.form === "state" ? (
                  <div className="form-row">
                    <label className="form-field">
                      <span>New state</span>
                      <select value={values.state ?? "open"} onChange={(e) => setForm(row.name, { state: e.target.value })}>
                        <option value="open">open</option>
                        <option value="closed">closed</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="menu-run">
              <button type="button" disabled={!canRun} onClick={() => void run(row)}>
                {running === row.name ? "Executing…" : "Confirm & execute"}
              </button>
            </div>

            {result !== undefined && result.status !== "idle" ? (
              <div className={`menu-result menu-result-${result.status}`} data-testid={`result-${row.name}`}>
                {result.status === "ok" ? (
                  <p>✓ executed (exit {result.exit ?? 0})</p>
                ) : null}
                {result.status === "failed" ? (
                  <p>✗ failed (exit {result.exit ?? "?"})</p>
                ) : null}
                {result.status === "rejected" ? (
                  <ul className="menu-reasons">
                    {result.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                {result.status === "error" ? <p className="parse-error">{result.message}</p> : null}
                {result.status === "ok" || result.status === "failed" ? (
                  <details className="menu-output">
                    <summary>command output</summary>
                    <pre>{result.outputTail || "(no output)"}</pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
