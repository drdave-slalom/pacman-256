import type {
  Attention,
  DiffTotals,
  FactorySnapshot,
  HandoffRef,
  Lifecycle,
  PullRequest,
  Stage,
  Unit,
} from "@maze/factory-control-shared";

/**
 * Pure selectors / reducers for the M1 web mirror. No React, no DOM, no
 * I/O — everything here is unit-testable against fixture snapshots and
 * shared by the board, detail, and agents views.
 */

export type AttentionTone = "danger" | "warn" | "success" | "info";

export interface AttentionBadge {
  key: Attention;
  label: string;
  tone: AttentionTone;
  glyph: string;
}

export const ATTENTION_META: Readonly<Record<Attention, Omit<AttentionBadge, "key">>> = {
  "blocked-agent": { label: "Blocked agent", tone: "danger", glyph: "⛔" },
  "review-pending": { label: "Review pending", tone: "warn", glyph: "👁" },
  "qa-pending": { label: "QA pending", tone: "warn", glyph: "🧪" },
  "ci-red": { label: "CI red", tone: "danger", glyph: "❌" },
  "ready-to-merge": { label: "Ready to merge", tone: "success", glyph: "🔀" },
  "ready-for-cleanup": { label: "Ready for cleanup", tone: "info", glyph: "🧹" },
  "needs-dispatch": { label: "Needs dispatch", tone: "warn", glyph: "📨" },
  "orphaned-artifacts": { label: "Orphaned artifacts", tone: "warn", glyph: "🧩" },
  "parse-error": { label: "Parse error", tone: "danger", glyph: "⚠️" },
};

export function attentionBadges(attention: readonly Attention[]): AttentionBadge[] {
  return attention.map((key) => ({ key, ...ATTENTION_META[key] }));
}

export interface LifecycleMeta {
  label: string;
  glyph: string;
  tone: AttentionTone | "muted";
}

export const LIFECYCLE_META: Readonly<Record<Lifecycle, LifecycleMeta>> = {
  working: { label: "Working", glyph: "●", tone: "success" },
  blocked: { label: "Blocked", glyph: "⛔", tone: "danger" },
  settling: { label: "Settling", glyph: "◐", tone: "warn" },
  starting: { label: "Starting", glyph: "◑", tone: "warn" },
  idle: { label: "Idle", glyph: "○", tone: "muted" },
  done: { label: "Done", glyph: "✓", tone: "success" },
  unknown: { label: "Unknown", glyph: "?", tone: "muted" },
  lost: { label: "Lost", glyph: "✕", tone: "danger" },
};

export const BOARD_COLUMNS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "spec", title: "Spec" },
  { key: "dispatch", title: "Dispatch" },
  { key: "execute", title: "Execute" },
  { key: "review", title: "Review" },
  { key: "qa", title: "QA" },
  { key: "integrate", title: "Integrate" },
  { key: "ci", title: "CI" },
  { key: "done", title: "Done" },
];

export interface BoardColumn {
  key: string;
  title: string;
  units: Unit[];
}

export interface BoardModel {
  columns: BoardColumn[];
  orphaned: {
    branches: string[];
    worktrees: string[];
    prs: PullRequest[];
    handoffs: HandoffRef[];
  };
}

/** Stage → kanban column key (identity over the shared `Stage` union). */
export function stageToColumn(stage: Stage): string {
  return stage;
}

/** Derive the board model (columns + orphaned bucket) from a snapshot. */
export function buildBoard(snapshot: FactorySnapshot): BoardModel {
  const columns: BoardColumn[] = [
    ...BOARD_COLUMNS.map((c) => ({ key: c.key, title: c.title, units: [] as Unit[] })),
    { key: "unknown", title: "Unknown", units: [] },
  ];
  for (const unit of snapshot.units) {
    const column = columns.find((c) => c.key === stageToColumn(unit.stage)) ?? columns[columns.length - 1];
    if (column !== undefined) column.units.push(unit);
  }
  for (const column of columns) {
    column.units.sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    columns,
    orphaned: {
      branches: [...snapshot.orphaned.branches],
      worktrees: [...snapshot.orphaned.worktrees],
      prs: [...snapshot.orphaned.prs],
      handoffs: [...snapshot.orphaned.handoffs],
    },
  };
}

export function totalOrphaned(board: BoardModel): number {
  return board.orphaned.branches.length + board.orphaned.worktrees.length + board.orphaned.prs.length + board.orphaned.handoffs.length;
}

export function unitById(snapshot: FactorySnapshot, id: string): Unit | undefined {
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
  return `+${diff.add} −${diff.del}`;
}

export function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface SummaryStats {
  units: number;
  agents: number;
  acting: number;
  working: number;
  blocked: number;
  attention: number;
  errors: number;
}

export function summarize(snapshot: FactorySnapshot): SummaryStats {
  const acting = snapshot.agents.filter((a) => a.state === "working" || a.state === "blocked" || a.state === "settling" || a.state === "starting").length;
  return {
    units: snapshot.units.length,
    agents: snapshot.agents.length,
    acting,
    working: snapshot.agents.filter((a) => a.state === "working").length,
    blocked: snapshot.agents.filter((a) => a.state === "blocked").length,
    attention: snapshot.units.reduce((n, u) => n + u.attention.length, 0),
    errors: snapshot.errors.length,
  };
}

export interface NextAction {
  label: string;
  note: string;
  tone: AttentionTone | "muted";
}

/**
 * Display-only suggested next action. Never performs a write — the note
 * keeps the operator-side TUI (M2/M3) as the only action surface.
 */
export function suggestNextAction(unit: Unit): NextAction {
  if (unit.attention.includes("blocked-agent")) {
    return { label: "Unblock agent", note: "Operator action — controller TUI", tone: "danger" };
  }
  if (unit.attention.includes("parse-error")) {
    return { label: "Fix spec parse error", note: "Operator action — controller TUI", tone: "danger" };
  }
  if (unit.attention.includes("needs-dispatch")) {
    return { label: "Dispatch unit", note: "Operator action — controller TUI", tone: "warn" };
  }
  if (unit.flags.reviewPending || unit.attention.includes("review-pending")) {
    return { label: "Assign PR review", note: "Operator action — controller TUI", tone: "warn" };
  }
  if (unit.flags.qaPending || unit.attention.includes("qa-pending")) {
    return { label: "Run QA pass", note: "Operator action — controller TUI", tone: "warn" };
  }
  if (unit.flags.ciRed || unit.attention.includes("ci-red")) {
    return { label: "Fix CI", note: "Operator action — controller TUI", tone: "danger" };
  }
  if (unit.flags.readyToMerge || unit.attention.includes("ready-to-merge")) {
    return { label: "Approve & merge", note: "Operator action — controller TUI", tone: "success" };
  }
  if (unit.attention.includes("ready-for-cleanup")) {
    return { label: "Remove worktree", note: "Operator action — controller TUI", tone: "info" };
  }
  if (unit.stage === "spec") {
    return { label: "Write spec & dispatch", note: "Operator action — controller TUI", tone: "warn" };
  }
  if (unit.stage === "unknown") {
    return { label: "Reconcile unit", note: "Unmatched artifacts need a home", tone: "warn" };
  }
  return { label: "No action", note: "Waiting on pipeline", tone: "muted" };
}
