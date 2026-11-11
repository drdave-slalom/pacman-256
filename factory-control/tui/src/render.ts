/**
 * Pure renderers for the factory-control TUI: snapshot → screen lines.
 *
 * Renderers never import pi runtime packages; they take an injected `LineStyle`
 * (identity in tests, theme-backed at runtime) so the same code path produces
 * the exact lines asserted by unit tests and the on-screen styling.
 */

import type { AgentRecord, FactorySnapshot, IssueCard, Unit } from "@maze/factory-control-shared";
import type { ActionMenuRow, MenuPlan, PreconditionLike } from "./actions.ts";
import type { DispatchEntryLike, DispatchPlanLike } from "./api.ts";
import {
  ATTENTION_GLYPH,
  agentContext,
  formatAge,
  formatChecks,
  formatDiff,
  formatElapsed,
  isActingState,
  issueDisplayStatus,
  LIFECYCLE_GLYPH,
  pipelineStages,
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

export type ViewKind = "board" | "detail" | "agents" | "actions" | "action-detail" | "queue" | "lead-prompt";

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
  // Issue-seeded/hybrid cards show `#<n> title [status]`; spec cards show id.
  const label = unit.issue !== undefined
    ? `#${unit.issue.number} ${unit.issue.title} [${issueDisplayStatus(unit.issue)}]`
    : unit.id;
  const id = selected ? style.accent(style.bold(label)) : label;
  // Source badge: any issue-backed card (standalone or hybrid) gets a prominent
  // `[GitHub]` tag, styled distinctly from the title/status text.
  const source = unit.issue !== undefined ? ` ${style.accent("[GitHub]")}` : "";
  return `${marker}${id}${source}${attentionLetters(unit)}${dirty}`;
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

/**
 * Boxed pipeline flow strip: the eight stages (Spec…Done) in order, each as a
 * 4-line box with its title and live unit count, joined by `→` arrows.
 *
 * Wrap rule: boxes are appended left-to-right; if the next box (plus its
 * separator) would exceed `width`, the current row ends and the box starts a
 * new row. Every returned line is truncated to `width` as a safety net. An
 * empty board (no units in any stage) renders a single dim "no units" line.
 */
export function renderPipelineStrip(model: BoardModel, style: LineStyle, width: number): string[] {
  const stages = pipelineStages(model);
  if (stages.every((s) => s.count === 0)) {
    return [truncateStyledToWidth(style.dim("no units"), width)];
  }

  const boxes = stages.map((s) => stageBox(s.title, s.count, style));
  const rows: string[][] = [];
  let current: string[] | null = null;
  let currentWidth = 0;
  for (const box of boxes) {
    if (current === null) {
      current = [...box.lines];
      currentWidth = box.width;
    } else if (currentWidth + 3 + box.width > width) {
      rows.push(current);
      current = [...box.lines];
      currentWidth = box.width;
    } else {
      current = current.map((line, i) => line + " → " + box.lines[i]);
      currentWidth += 3 + box.width;
    }
  }
  if (current !== null) rows.push(current);

  return rows.flat().map((line) => truncateStyledToWidth(line, width));
}

/**
 * Truncate a possibly-ANSI-styled line to `maxWidth` visible columns. The
 * strip's glyphs are all single-width, so visible width is the count of
 * non-escape characters; SGR (color/bold) escape sequences are preserved
 * verbatim and count as zero width.
 */
function truncateStyledToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const SGR = /\x1b\[[0-9;]*m/g;
  let out = "";
  let visible = 0;
  let last = 0;
  for (const m of text.matchAll(SGR)) {
    const idx = m.index ?? 0;
    const plain = text.slice(last, idx);
    const take = Math.min(plain.length, maxWidth - visible);
    if (take < plain.length) return out + plain.slice(0, take);
    out += plain + m[0];
    visible += plain.length;
    last = idx + m[0].length;
  }
  return out + text.slice(last).slice(0, Math.max(0, maxWidth - visible));
}

interface StageBox {
  lines: string[];
  /** Display width of the box (2 borders + inner), independent of styling. */
  width: number;
}

/** A single 4-line stage box: border / title / count / border. */
function stageBox(title: string, count: number, style: LineStyle): StageBox {
  const countText = "(" + count + ")";
  const inner = Math.max(title.length, countText.length) + 2;
  const top = style.muted("┌" + "─".repeat(inner) + "┐");
  const bottom = style.muted("└" + "─".repeat(inner) + "┘");
  const titlePad = Math.max(0, inner - 2 - title.length);
  const titleLine = style.muted("│ ") + style.accent(style.bold(title)) + " ".repeat(titlePad) + style.muted(" │");
  // Center the count between the same 1-space margins the title row uses.
  const innerText = inner - 2;
  const leftPad = Math.floor((innerText - countText.length) / 2);
  const rightPad = innerText - countText.length - leftPad;
  const countLine = style.muted("│ ") + " ".repeat(leftPad) + style.muted(countText) + " ".repeat(rightPad) + style.muted(" │");
  return { lines: [top, titleLine, countLine, bottom], width: inner + 2 };
}

/**
 * "Closed issues (N)" section for closed-unmatched issues (always visible): a
 * header row plus one dim row per issue `#N title [status]` (via
 * `issueDisplayStatus`), truncated to width. Hidden (returns no lines) when
 * the list is empty.
 */
export function renderClosedIssues(issues: IssueCard[], style: LineStyle, width: number): string[] {
  if (issues.length === 0) return [];
  const lines: string[] = [];
  lines.push(style.muted(`${style.accent("Closed issues")} (${issues.length})`));
  for (const issue of issues) {
    lines.push(style.dim(`  #${issue.number} ${issue.title} [${issueDisplayStatus(issue)}]`));
  }
  return lines.map((line) => truncateToWidth(line, width));
}

export function renderBoardBody(
  model: BoardModel,
  selectedIndex: number,
  style: LineStyle,
  width: number,
  closedIssues: IssueCard[],
): string[] {
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
  if (closedIssues.length > 0) {
    lines.push(...renderClosedIssues(closedIssues, style, width));
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

  if (unit.issue !== undefined) {
    const issue = unit.issue;
    lines.push(style.muted("issue"));
    lines.push(`  #${issue.number} ${issue.title}`);
    lines.push(
      `  state ${issue.state} · status ${issueDisplayStatus(issue)} · updated ${issue.updatedAt !== undefined ? formatAge(issue.updatedAt) : "—"}`,
    );
    const labelParts: string[] = [];
    if (issue.labels.type !== undefined) labelParts.push(`type:${issue.labels.type}`);
    if (issue.labels.lane !== undefined) labelParts.push(`lane:${issue.labels.lane}`);
    if (issue.labels.status !== undefined) labelParts.push(`status:${issue.labels.status}`);
    const roles = issue.labels.role ?? [];
    if (roles.length > 0) labelParts.push(`role:${roles.join("+")}`);
    if (issue.labels.blocked) labelParts.push("blocked");
    if (issue.labels.followUp) labelParts.push("follow-up");
    if (issue.labels.playtest) labelParts.push("playtest");
    const labels = labelParts.length > 0 ? labelParts.join(", ") : "none";
    const raw = issue.labels.raw.length > 0 ? ` · raw: ${issue.labels.raw.join(", ")}` : "";
    lines.push(`  labels ${labels}${raw}`);
    lines.push(`  assignees ${issue.assignees.length > 0 ? issue.assignees.join(", ") : "none"} · milestone ${issue.milestone ?? "none"}`);
    lines.push(`  url ${truncateToWidth(issue.url, width - 6)}`);
    if (issue.bodyExcerpt !== undefined && issue.bodyExcerpt !== "") {
      lines.push(style.dim(`  body ${truncateToWidth(issue.bodyExcerpt, width - 8)}`));
    }
  }

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

function isDispatchPlan(plan: MenuPlan): plan is DispatchPlanLike {
  const p = plan as DispatchPlanLike;
  return p.kind === "dispatch" || p.kind === "skill";
}

export function renderActionPlan(row: ActionMenuRow, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  lines.push(style.accent(style.bold(row.label)));
  const plan = row.plan;
  if (plan !== undefined && isDispatchPlan(plan)) {
    // M4 trigger plan: role/worktree/spec/acceptance + the lead prompt.
    lines.push(style.muted("delegation plan"));
    lines.push(`  role ${style.accent(plan.role)} · worktree ${plan.worktree}`);
    if (plan.specPath !== undefined) lines.push(`  spec ${plan.specPath}`);
    if (plan.acceptance !== "") {
      lines.push(style.muted("acceptance"));
      lines.push(`  ${truncateToWidth(plan.acceptance, width - 4)}`);
    }
    lines.push(style.muted("lead prompt"));
    for (const p of plan.delegationPrompt.split("\n")) {
      lines.push(style.dim(`  ${truncateToWidth(p, Math.max(20, width - 4))}`));
    }
  } else if (plan !== undefined) {
    lines.push(style.muted("plan"));
    lines.push(`  ${truncateToWidth(plan.summary, width - 4)}`);
    lines.push(style.muted("steps"));
    for (const step of plan.steps) {
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
    lines.push(style.error("trigger blocked by preconditions — not runnable"));
  } else {
    const hint = row.kind !== undefined && row.kind !== "action" ? "enter = confirm & enqueue · esc = back" : "enter = confirm & execute · esc = back";
    lines.push(style.dim(hint));
  }
  return lines.map((line) => truncateToWidth(line, width));
}

export function renderQueueView(entries: DispatchEntryLike[], selectedIndex: number, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  lines.push(`${style.accent(style.bold("Dispatch queue"))}  (${entries.length})`);
  if (entries.length === 0) {
    lines.push(style.dim("  no entries — dispatch a unit or run a skill from a unit's action menu"));
  } else {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry === undefined) continue;
      const marker = i === selectedIndex ? "› " : "  ";
      const skill = entry.skill !== undefined ? ` skill=${entry.skill}` : "";
      const role = entry.role !== undefined ? ` role=${entry.role}` : "";
      const spec = entry.specPath !== undefined ? `  ${entry.specPath}` : "";
      lines.push(`${marker}${i === selectedIndex ? style.accent("[" + entry.status + "]") : "[" + entry.status + "]"} ${entry.id} ${entry.unit}${role}${skill}${spec}`);
    }
  }
  lines.push(style.dim("enter = lead prompt · r refresh · esc back"));
  return lines.map((line) => truncateToWidth(line, width));
}

export function renderLeadPrompt(entry: DispatchEntryLike, style: LineStyle, width: number): string[] {
  const lines: string[] = [];
  lines.push(`${style.accent(style.bold("Lead delegation prompt"))}  ${entry.id} · ${entry.status}`);
  lines.push(rule(width));
  const text = entry.prompt ?? "(no prompt available for this entry)";
  for (const line of text.split("\n")) {
    lines.push(truncateToWidth(line, width));
  }
  lines.push(style.dim(rule(width)));
  lines.push(style.dim("c = notify copy hint · esc = back"));
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
    board: "↑/↓ move · enter detail · a agents · q queue · r refresh · esc close",
    detail: "↑/↓ switch unit · esc board · x actions · a agents · q queue · r refresh",
    agents: "↑/↓ select · enter focus · esc back",
    actions: "↑/↓ select · enter open · esc back",
    "action-detail": "enter confirm & execute · esc back",
    queue: "↑/↓ select · enter lead prompt · r refresh · esc back",
    "lead-prompt": "esc back · c notify copy hint",
  };
  const line = style.dim(map[view]);
  return [truncateToWidth(line, width), style.dim(rule(width))];
}
