/**
 * Pure selectors for the factory-control TUI. No pi packages, no I/O —
 * everything here is unit-testable against fixture snapshots and used by the
 * board/detail/agents renderers and the interactive screen.
 */

import type {
  Attention,
  AgentRecord,
  DiffTotals,
  FactorySnapshot,
  IssueCard,
  Unit,
} from "@maze/factory-control-shared";

/** Stage → column order (identity over the shared `Stage` union + orphaned). */
export const STAGE_COLUMNS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "spec", title: "Spec" },
  { key: "dispatch", title: "Dispatch" },
  { key: "execute", title: "Execute" },
  { key: "review", title: "Review" },
  { key: "qa", title: "QA" },
  { key: "integrate", title: "Integrate" },
  { key: "ci", title: "CI" },
  { key: "done", title: "Done" },
];

export interface OrphanedModel {
  branches: string[];
  worktrees: string[];
  prs: { number: number; headRefName?: string }[];
  handoffs: string[];
}

export interface ColumnModel {
  key: string;
  title: string;
  units: Unit[];
}

export interface BoardModel {
  columns: ColumnModel[];
  orphaned: OrphanedModel;
}

/** Attention badge glyphs (single-width letters, stable for tests/terminals). */
export const ATTENTION_GLYPH: Readonly<Record<Attention, string>> = {
  "blocked-agent": "B",
  "review-pending": "R",
  "qa-pending": "Q",
  "ci-red": "X",
  "ready-to-merge": "M",
  "ready-for-cleanup": "C",
  "needs-dispatch": "D",
  "orphaned-artifacts": "O",
  "parse-error": "P",
};

export const ATTENTION_LABEL: Readonly<Record<Attention, string>> = {
  "blocked-agent": "blocked agent",
  "review-pending": "review pending",
  "qa-pending": "QA pending",
  "ci-red": "CI red",
  "ready-to-merge": "ready to merge",
  "ready-for-cleanup": "ready for cleanup",
  "needs-dispatch": "needs dispatch",
  "orphaned-artifacts": "orphaned artifacts",
  "parse-error": "parse error",
};

export const ATTENTION_ORDER: ReadonlyArray<Attention> = [
  "blocked-agent",
  "review-pending",
  "qa-pending",
  "ci-red",
  "ready-to-merge",
  "ready-for-cleanup",
  "needs-dispatch",
  "orphaned-artifacts",
  "parse-error",
];

/** Lifecycle glyphs (single-width). */
export const LIFECYCLE_GLYPH: Readonly<Record<string, string>> = {
  working: "*",
  blocked: "!",
  settling: "~",
  starting: ">",
  idle: "-",
  done: "+",
  unknown: "?",
  lost: "x",
};

const ACTING_STATES = new Set(["working", "blocked", "settling", "starting"]);

export function isActingState(state: string): boolean {
  return ACTING_STATES.has(state);
}

/** Display status for an issue card: the `status:*` label when present, else the GitHub state. */
export function issueDisplayStatus(issue: IssueCard): string {
  return issue.labels.status ?? issue.state;
}

/**
 * Closed issues not attached to any unit card (`state === "closed"` and no
 * `unit.issue.number` match across `snapshot.units`), sorted ascending by
 * number. Pure selection shared by the "show closed issues" toggle on the
 * TUI and web board surfaces.
 */
export function closedUnmatchedIssues(snapshot: FactorySnapshot): IssueCard[] {
  const linkedNumbers = new Set(
    snapshot.units.map((u) => u.issue?.number).filter((n): n is number => n !== undefined),
  );
  return snapshot.issues
    .filter((i) => i.state === "closed" && !linkedNumbers.has(i.number))
    .sort((a, b) => a.number - b.number);
}

/** Build the board model (stage columns + orphaned bucket) from a snapshot. */
export function buildBoard(snapshot: FactorySnapshot, filter = ""): BoardModel {
  const q = filter.trim().toLowerCase();
  const match = (unit: Unit): boolean =>
    q === "" ||
    unit.id.toLowerCase().includes(q) ||
    (unit.title ?? "").toLowerCase().includes(q) ||
    (unit.lane ?? "").toLowerCase().includes(q) ||
    (unit.specPath ?? "").toLowerCase().includes(q) ||
    (unit.branch ?? "").toLowerCase().includes(q) ||
    (unit.issue !== undefined &&
      (String(unit.issue.number).includes(q) || unit.issue.title.toLowerCase().includes(q)));

  const columns: ColumnModel[] = [
    ...STAGE_COLUMNS.map((c) => ({ key: c.key, title: c.title, units: [] as Unit[] })),
    { key: "unknown", title: "Unknown", units: [] },
  ];
  for (const unit of snapshot.units) {
    if (!match(unit)) continue;
    const col = columns.find((c) => c.key === unit.stage) ?? columns[columns.length - 1];
    if (col !== undefined) col.units.push(unit);
  }
  for (const col of columns) {
    col.units.sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    columns,
    orphaned: {
      branches: [...snapshot.orphaned.branches],
      worktrees: [...snapshot.orphaned.worktrees],
      prs: snapshot.orphaned.prs.map((p) => ({ number: p.number, headRefName: p.headRefName })),
      handoffs: snapshot.orphaned.handoffs.map((h) => h.agent ?? h.definition ?? "?"),
    },
  };
}

export interface PipelineStage {
  key: string;
  title: string;
  count: number;
}

/**
 * The eight flow-strip stages (Spec…Done) with live unit counts, in order.
 * `Unknown`/`Orphaned` are deliberately excluded — they stay below the strip.
 */
export function pipelineStages(model: BoardModel): PipelineStage[] {
  return STAGE_COLUMNS.map((c) => {
    const col = model.columns.find((x) => x.key === c.key);
    return { key: c.key, title: c.title, count: col?.units.length ?? 0 };
  });
}

/** Flat list of units in the same order the board renderer draws them. */
export function flattenUnits(model: BoardModel): Unit[] {
  const out: Unit[] = [];
  for (const col of model.columns) {
    for (const unit of col.units) out.push(unit);
  }
  return out;
}

export interface AttentionSummary {
  counts: { key: Attention; label: string; glyph: string; count: number }[];
  total: number;
}

export function summarizeAttention(snapshot: FactorySnapshot): AttentionSummary {
  const counts = new Map<Attention, number>();
  for (const unit of snapshot.units) {
    for (const key of unit.attention) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const entries = ATTENTION_ORDER.map((key) => ({
    key,
    label: ATTENTION_LABEL[key] ?? key,
    glyph: ATTENTION_GLYPH[key] ?? "?",
    count: counts.get(key) ?? 0,
  })).filter((e) => e.count > 0);
  const total = entries.reduce((n, e) => n + e.count, 0);
  return { counts: entries, total };
}

export function unitById(snapshot: FactorySnapshot | null, id: string | undefined): Unit | undefined {
  if (snapshot === null || id === undefined) return undefined;
  return snapshot.units.find((u) => u.id === id);
}

/** Short branch display: strip a remote `origin/` prefix. */
export function showBranch(branch: string): string {
  return branch.replace(/^origin\//, "");
}

export function formatElapsed(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDiff(diff: DiffTotals | undefined): string {
  if (diff === undefined) return "";
  return `+${diff.add} -${diff.del}`;
}

export function formatAge(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatChecks(checks: string | undefined): string {
  return checks ?? "unavailable";
}

export interface NextAction {
  label: string;
  note: string;
}

/** Display-only suggested next action (never performs a write). */
export function suggestNextAction(unit: Unit): NextAction {
  if (unit.attention.includes("blocked-agent")) {
    return { label: "Unblock agent", note: "operator action" };
  }
  if (unit.attention.includes("parse-error")) {
    return { label: "Fix spec parse error", note: "operator action" };
  }
  if (unit.attention.includes("needs-dispatch")) {
    return { label: "Dispatch unit", note: "operator action" };
  }
  if (unit.flags.reviewPending || unit.attention.includes("review-pending")) {
    return { label: "Assign PR review", note: "operator action" };
  }
  if (unit.flags.qaPending || unit.attention.includes("qa-pending")) {
    return { label: "Run QA pass", note: "operator action" };
  }
  if (unit.flags.ciRed || unit.attention.includes("ci-red")) {
    return { label: "Fix CI", note: "operator action" };
  }
  if (unit.flags.readyToMerge || unit.attention.includes("ready-to-merge")) {
    return { label: "Approve & merge", note: "operator action" };
  }
  if (unit.attention.includes("ready-for-cleanup")) {
    return { label: "Remove worktree", note: "operator action" };
  }
  if (unit.stage === "spec") {
    return { label: "Write spec & dispatch", note: "operator action" };
  }
  if (unit.stage === "unknown") {
    return { label: "Reconcile unit", note: "unmatched artifacts need a home" };
  }
  return { label: "No action", note: "waiting on pipeline" };
}

export function agentContext(agent: AgentRecord): string {
  if (agent.contextPct === undefined) return "—";
  return `${agent.contextPct}%`;
}
