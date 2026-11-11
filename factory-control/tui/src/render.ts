/**
 * Pure renderers for the factory-control TUI: snapshot → screen lines.
 *
 * Renderers never import pi runtime packages; they take an injected `LineStyle`
 * (identity in tests, theme-backed at runtime) so the same code path produces
 * the exact lines asserted by unit tests and the on-screen styling.
 */

import type { AgentRecord, FactorySnapshot, Unit } from "@maze/factory-control-shared";
import type { ActionMenuRow, PreconditionLike } from "./actions.ts";
import {
  ATTENTION_GLYPH,
  agentContext,
  formatAge,
  formatChecks,
  formatDiff,
  formatElapsed,
  isActingState,
  LIFECYCLE_GLYPH,
  showBranch,
  suggestNextAction,
  type BoardModel,
  type OrphanedModel,
} from "./selectors.ts";
import { truncateToWidth } from "./width.ts";

/** Styling seam. Tests pass `plainStyle`; the screen passes theme-backed fns. */
export interface LineStyle {
  dim(s: string): string;
  muted(s: string): string;
  accent(s: string): string;
  warn(s: string): string;
  success(s: string): string;
  error(s: string): string;
  bold(s: string): string;
}

export const plainStyle: LineStyle = {
  dim: (s) => s,
  muted: (s) => s,
  accent: (s) => s,
  warn: (s) => s,
  success: (s) => s,
  error: (s) => s,
  bold: (s) => s,
};

export type ViewKind = "board" | "detail" | "agents" | "actions" | "action-detail";

const DIVIDER = "─";

function rule(width: number): string {
  return DIVIDER.repeat(Math.max(0, width));
}

function attentionLetters(unit: Unit): string {
  if (unit.attention.length === 0) return "";
  return ` [${unit.attention.map((a) => ATTENTION_GLYPH[a]).join("")}]`;
}

function cardLine(unit: Unit, selected: boolean, style: LineStyle): string {
  const marker = selected ? "› " : "  ";
  const dirty = unit.worktree?.dirty === true ? " *" : "";
  const id = selected ? style.accent(style.bold(unit.id)) : unit.id;
  return `${marker}${id}${attentionLetters(unit)}${dirty}`;
}

export function renderHeader(snapshot: FactorySnapshot | null, style: LineStyle, width: number): string[] {
  if (snapshot === null) {
    return [style.accent(style.bold("factory control")), rule(width)];
  }
  const dirty = snapshot.repo.dirty ? " (dirty)" : "";
  const age = formatAge(snapshot.generatedAt);
  const attn = snapshot.units.reduce((n, u) => n + u.attention.length, 0);
  const errors = snapshot.errors.length > 0 ? ` · errors ${snapshot.errors.length}` : "";
  const line = `${style.accent(style.bold("factory control"))}  ${showBranch(snapshot.repo.branch)}${dirty} · ${age} · attn ${attn}${errors}`;
  return [line, rule(width)];
}

export interface OfflineBannerState {
  retrying: boolean;
  serverStarted: boolean;
  error?: string;
}

export function renderOfflineBanner(state: OfflineBannerState, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  const retry = state.retrying ? "retrying…" : "[r] retry";
  const start = state.serverStarted ? "server start requested" : "[s] start server";
  lines.push(
    style.error(
      style.bold(`! control server unreachable`) +
        (state.error !== undefined ? ` — ${truncateToWidth(state.error, Math.max(20, width - 40))}` : ""),
    ),
  );
  lines.push(style.dim(`${retry}   ${start}   [esc] close`));
  lines.push(rule(width));
  return lines;
}

export function renderBoardBody(model: BoardModel, selectedIndex: number, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  let cursor = 0;
  for (const col of model.columns) {
    lines.push(style.muted(`${style.accent(col.title)} (${col.units.length})`));
    for (const unit of col.units) {
      lines.push(cardLine(unit, cursor === selectedIndex, style));
      cursor += 1;
    }
  }
  lines.push(style.muted(`${style.accent("Orphaned")} (${totalOrphaned(model.orphaned)})`));
  const orphanLines: string[] = [];
  for (const branch of model.orphaned.branches) orphanLines.push(`branch ${branch}`);
  for (const path of model.orphaned.worktrees) orphanLines.push(`worktree ${path}`);
  for (const pr of model.orphaned.prs) orphanLines.push(`PR #${pr.number} (${pr.headRefName ?? "?"})`);
  for (const ho of model.orphaned.handoffs) orphanLines.push(`handoff ${ho}`);
  if (orphanLines.length === 0) {
    lines.push(style.dim("  none"));
  } else {
    for (const line of orphanLines) lines.push(style.dim(`  ${line}`));
  }
  return lines.map((line) => truncateToWidth(line, width));
}

function totalOrphaned(orphaned: OrphanedModel): number {
  return (
    orphaned.branches.length +
    orphaned.worktrees.length +
    orphaned.prs.length +
    orphaned.handoffs.length
  );
}

export function renderAgentsView(agents: AgentRecord[], selectedIndex: number, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (agent === undefined) continue;
    const marker = i === selectedIndex ? "› " : "  ";
    const glyph = LIFECYCLE_GLYPH[agent.state] ?? "?";
    const elapsed = formatElapsed(agent.elapsedMs);
    const model = agent.model !== undefined ? ` ${agent.model}` : "";
    const line = `${marker}${i === selectedIndex ? style.accent(agent.label) : agent.label} ${style.muted(glyph)} ${agent.definition} ${elapsed}${model} ctx ${agentContext(agent)}`;
    lines.push(truncateToWidth(line, width));
  }
  lines.push(style.dim("enter → open owning unit detail"));
  return lines;
}

export function renderDetail(unit: Unit, snapshot: FactorySnapshot | null, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  const badges = attentionLetters(unit);
  lines.push(style.accent(style.bold(unit.id)) + `  [stage: ${style.muted(unit.stage)}]${badges}`);
  if (unit.lane !== undefined) lines.push(`lane: ${unit.lane}`);

  lines.push(style.muted("spec"));
  lines.push(`  ${unit.specPath ?? "no SPEC file"}${unit.title !== undefined ? ` — ${unit.title}` : ""}`);
  if (unit.goal !== undefined) lines.push(style.dim(`  goal: ${truncateToWidth(unit.goal, width - 8)}`));

  lines.push(style.muted("git"));
  const branch = unit.branch !== undefined ? showBranch(unit.branch) : "—";
  const wt = unit.worktree?.path ?? "—";
  const dirty = unit.worktree?.dirty === true ? " dirty" : "";
  const diff = formatDiff(unit.worktree?.diff);
  lines.push(`  branch ${branch} · worktree ${wt}${dirty}${diff !== "" ? ` · ${diff}` : ""}`);

  lines.push(style.muted("pr / checks"));
  if (unit.pr !== undefined) {
    lines.push(`  #${unit.pr.number} ${String(unit.pr.state).toUpperCase()} checks ${formatChecks(unit.pr.checks)} · ${unit.pr.url}`);
  } else {
    lines.push("  no PR");
  }

  lines.push(style.muted("agents"));
  if (unit.agents.length === 0) {
    lines.push("  none");
  } else {
    for (const agent of unit.agents) {
      const glyph = LIFECYCLE_GLYPH[agent.state] ?? "?";
      const acting = isActingState(agent.state) ? " *" : "";
      lines.push(`  ${agent.label} ${glyph} ${agent.definition} ${formatElapsed(agent.elapsedMs)}${acting}`);
    }
  }

  lines.push(style.muted("handoff trail"));
  if (unit.handoffs.length === 0) {
    lines.push("  none");
  } else {
    for (const ho of unit.handoffs.slice(0, 6)) {
      const agent = ho.agent ?? "?";
      const def = ho.definition !== undefined ? ` · ${ho.definition}` : "";
      const session = ho.sessionId !== undefined ? ` · ${ho.sessionId}` : "";
      lines.push(`  ${agent}${def}${session}`);
      if (ho.excerpt !== undefined && ho.excerpt !== "") {
        lines.push(style.dim(`    ${truncateToWidth(ho.excerpt, width - 6)}`));
      }
    }
  }

  const next = suggestNextAction(unit);
  lines.push(style.muted("next action"));
  lines.push(`  ${style.warn(style.bold(next.label))} — ${next.note}`);

  lines.push(style.muted("flags"));
  const flagParts: string[] = [];
  if (unit.flags.reviewPending) flagParts.push("reviewPending");
  if (unit.flags.qaPending) flagParts.push("qaPending");
  if (unit.flags.ciRed) flagParts.push("ciRed");
  if (unit.flags.readyToMerge) flagParts.push("readyToMerge");
  if (unit.flags.readyForCleanup) flagParts.push("readyForCleanup");
  if (unit.flags.needsDispatch) flagParts.push("needsDispatch");
  if (unit.flags.blockedAgent) flagParts.push("blockedAgent");
  lines.push(`  ${flagParts.length > 0 ? flagParts.join(", ") : "none"}`);

  return lines.map((line) => truncateToWidth(line, width));
}

export function renderActionMenu(rows: ActionMenuRow[], selectedIndex: number, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const marker = i === selectedIndex ? "› " : "  ";
    const badge = row.ok ? style.success("ok") : style.error("✗");
    lines.push(`${marker}${badge} ${row.label} — ${row.hint}`);
    if (!row.ok) {
      for (const reason of row.reasons.slice(0, 3)) {
        lines.push(style.dim(`    ${truncateToWidth(reason, width - 6)}`));
      }
    }
  }
  lines.push(style.dim("enter = open selected action · esc = back"));
  return lines.map((line) => truncateToWidth(line, width));
}

export function renderActionPlan(row: ActionMenuRow, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  lines.push(style.accent(style.bold(row.label)));
  if (row.plan !== undefined) {
    lines.push(style.muted("plan"));
    lines.push(`  ${truncateToWidth(row.plan.summary, width - 4)}`);
    lines.push(style.muted("steps"));
    for (const step of row.plan.steps) {
      const cwd = step.cwd !== undefined ? `  # cwd: ${step.cwd}` : "";
      lines.push(style.dim(`  $ ${truncateToWidth(`${step.command} ${step.args.join(" ")}${cwd}`, width - 4)}`));
    }
  }
  lines.push(style.muted("preconditions"));
  const preconditions = row.preconditions;
  for (const p of preconditions) {
    const mark = p.ok ? style.success("✓") : style.error("✗");
    lines.push(`  ${mark} ${p.name} — ${truncateToWidth(p.detail, width - 8)}`);
  }
  if (!row.ok) {
    lines.push(style.error("action blocked by preconditions — not runnable"));
  } else {
    lines.push(style.dim("enter = confirm & execute · esc = back"));
  }
  return lines.map((line) => truncateToWidth(line, width));
}

export type ActionResultState =
  | { kind: "running" }
  | { kind: "ok"; outcome: { outcome: "success" | "failed"; command: string[]; exit: number | null; outputTail: string } }
  | { kind: "error"; message: string; preconditions?: PreconditionLike[] };

export function renderActionResult(state: ActionResultState, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  if (state.kind === "running") {
    lines.push(style.muted("running action…"));
    return lines;
  }
  if (state.kind === "ok") {
    const ok = state.outcome.outcome === "success";
    const head = ok
      ? style.success(style.bold(`✓ success${state.outcome.exit !== null ? ` · exit ${state.outcome.exit}` : ""}`))
      : style.error(style.bold(`✗ failed · exit ${state.outcome.exit ?? "?"}`));
    lines.push(head);
    lines.push(style.muted("command"));
    for (const cmd of state.outcome.command) lines.push(style.dim(`  ${truncateToWidth(cmd, width - 4)}`));
    const tail = state.outcome.outputTail.split("\n").slice(-14);
    if (tail.length > 0) {
      lines.push(style.muted("output (tail)"));
      for (const line of tail) lines.push(style.dim(`  ${truncateToWidth(line, width - 4)}`));
    }
    return lines;
  }
  const status = state.preconditions !== undefined && state.preconditions.length > 0 ? " (409 preconditions)" : "";
  lines.push(style.error(style.bold(`✗ rejected${status}`)) + ` — ${truncateToWidth(state.message, Math.max(20, width - 28))}`);
  if (state.preconditions !== undefined) {
    for (const p of state.preconditions) {
      if (p.ok) continue;
      lines.push(style.dim(`  ${p.name}: ${truncateToWidth(p.detail, width - 6)}`));
    }
  }
  lines.push(style.dim("esc = back"));
  return lines;
}

export function renderHelp(view: ViewKind, style: LineStyle, width: number): string[] {
  const map: Record<ViewKind, string> = {
    board: "↑/↓ move · enter detail · a agents · r refresh · esc close",
    detail: "↑/↓ switch unit · esc board · x actions · a agents · r refresh",
    agents: "↑/↓ select · enter focus · esc back",
    actions: "↑/↓ select · enter open · esc back",
    "action-detail": "enter confirm & execute · esc back",
  };
  const line = style.dim(map[view]);
  return [truncateToWidth(line, width), style.dim(rule(width))];
}
