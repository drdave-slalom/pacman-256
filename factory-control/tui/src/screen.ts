/**
 * The interactive Factory screen component (M3).
 *
 * This is the component returned from `ctx.ui.custom()`. It owns polling the
 * M0 snapshot, the board/detail/agents/action views, and the M2 action flows.
 * Rendering is delegated to the pure renderers in `render.ts`; keyboard
 * routing to `keyroutes.ts`; the M2 API calls to `api.ts`.
 *
 * Herdr integration: the agents panel is read-only. Selecting an agent row
 * does NOT reimplement pane focus (there is no public Herdr focus API); it
 * falls back to opening the owning unit's detail view, leaving the native
 * Herdr widget/pane management untouched.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FactorySnapshot, Unit } from "@maze/factory-control-shared";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  ScrollView,
  Text,
  truncateToWidth,
  type Component,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import {
  ApiError,
  dispatchEnqueue,
  dispatchPrepare,
  dispatchQueue,
  executeAction,
  fetchSnapshot,
  healthz,
  prepareAction,
  type ActionResultLike,
  type DispatchEntryLike,
  type DispatchPrepareResponse,
  type PrepareResponse,
} from "./api.ts";
import {
  buildActionMenu,
  candidateActions,
  type ActionMenuRow,
  type MenuCandidate,
  type PreparedOutcome,
} from "./actions.ts";
import { handleKey, type FactoryScreenOps } from "./keyroutes.ts";
import {
  renderActionMenu,
  renderActionPlan,
  renderActionResult,
  renderAgentsView,
  renderBoardBody,
  renderDetail,
  renderHeader,
  renderHelp,
  renderLeadPrompt,
  renderOfflineBanner,
  renderQueueView,
  type ActionResultState,
  type LineStyle,
  type OfflineBannerState,
  type ViewKind,
} from "./render.ts";
import { buildBoard, flattenUnits, formatAge, summarizeAttention, type BoardModel } from "./selectors.ts";
import { candidateTriggers, type TriggerCandidate } from "./triggers.ts";

const POLL_MS = 5000;

export interface FactoryScreenOptions {
  tui: TUI;
  theme: Theme;
  kb: { matches(data: string, binding: string): boolean };
  done: (value?: void) => void;
  ctx: ExtensionContext;
  query: string;
  /** Snapshot fetcher (injectable for tests). Defaults to the real client. */
  fetchSnapshotImpl?: (signal?: AbortSignal) => Promise<FactorySnapshot>;
  /** M2 prepare (injectable for tests). Defaults to the real client. */
  prepareActionImpl?: (name: string, body: Record<string, unknown>) => Promise<PrepareResponse>;
  /** M2 execute (injectable for tests). Defaults to the real client. */
  executeActionImpl?: (name: string, requestId: string, approvedBy?: string) => Promise<ActionResultLike>;
  /** M4 dispatch prepare (injectable for tests). Defaults to the real client. */
  dispatchPrepareImpl?: (body: { unit: string; skill?: string }) => Promise<DispatchPrepareResponse>;
  /** M4 enqueue (injectable for tests). Defaults to the real client. */
  dispatchEnqueueImpl?: (requestId: string) => Promise<{ entry: DispatchEntryLike; prompt: string }>;
  /** M4 queue list (injectable for tests). Defaults to the real client. */
  dispatchQueueImpl?: () => Promise<{ entries: DispatchEntryLike[] }>;
}

function styleFromTheme(theme: Theme): LineStyle {
  return {
    dim: (s) => theme.fg("dim", s),
    muted: (s) => theme.fg("muted", s),
    accent: (s) => theme.fg("accent", s),
    warn: (s) => theme.fg("warning", s),
    success: (s) => theme.fg("success", s),
    error: (s) => theme.fg("error", s),
    bold: (s) => theme.bold(s),
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Walk up from `start` to the repo root hosting `factory-control/server/src/index.ts`. */
function findFactoryRoot(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "factory-control", "server", "src", "index.ts"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function spawnControlServer(cwd: string): { ok: boolean; reason?: string } {
  const root = findFactoryRoot(cwd) ?? cwd;
  const entry = join(root, "factory-control", "server", "src", "index.ts");
  if (!existsSync(entry)) {
    return { ok: false, reason: `control server entry not found: ${entry}` };
  }
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", entry], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, FACTORY_ROOT: root },
    });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: errorMessage(e) };
  }
}

export class FactoryScreen implements Component {
  readonly capturesViewportInput = true;

  private readonly opts: FactoryScreenOptions;
  private snapshot: FactorySnapshot | null = null;
  private offline: OfflineBannerState = { retrying: false, serverStarted: false };
  private view: ViewKind = "board";
  private prevView: ViewKind = "board";
  private model: BoardModel | null = null;
  private flat: Unit[] = [];
  private selectedUnit = 0;
  private selectedAgent = 0;
  private rows: ActionMenuRow[] = [];
  private selectedAction = 0;
  private activeRow: ActionMenuRow | null = null;
  private resultState: ActionResultState | null = null;
  private preparedRequestId: string | undefined;
  private runningAction = false;
  private preparingActions = false;
  private actionPrepToken = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;
  private disposed = false;
  private queueEntries: DispatchEntryLike[] = [];
  private selectedQueue = 0;
  private activeQueueEntry: DispatchEntryLike | undefined;
  private scroll = new ScrollView(new Text(""));
  private lastHeadLen = 0;
  private lastRegion = 0;
  private rowMap: number[] = [];

  constructor(opts: FactoryScreenOptions) {
    this.opts = opts;
    void this.refresh();
    this.timer = setInterval(() => {
      if (!this.disposed) void this.refresh();
    }, POLL_MS);
  }

  // ------------------------------------------------------------------ data

  private async refresh(): Promise<void> {
    if (this.inFlight || this.disposed) return;
    this.inFlight = true;
    try {
      const snap = await (this.opts.fetchSnapshotImpl ?? fetchSnapshot)();
      this.snapshot = snap;
      this.offline = { retrying: false, serverStarted: this.offline.serverStarted };
      this.rebuild();
      this.updateWidget();
      if (this.view === "queue" || this.view === "lead-prompt") {
        void this.loadQueue().catch(() => {});
      }
    } catch (e) {
      this.offline = {
        retrying: false,
        serverStarted: this.offline.serverStarted,
        error: errorMessage(e),
      };
    } finally {
      this.inFlight = false;
      this.bump();
    }
  }

  private rebuild(): void {
    if (this.snapshot === null) {
      this.model = null;
      this.flat = [];
      return;
    }
    this.model = buildBoard(this.snapshot, this.opts.query);
    this.flat = flattenUnits(this.model);
    this.selectedUnit = this.flat.length === 0 ? 0 : clamp(this.selectedUnit, 0, this.flat.length - 1);
  }

  private currentUnit(): Unit | undefined {
    return this.flat[this.selectedUnit];
  }

  private updateWidget(): void {
    const snap = this.snapshot;
    if (snap === null) {
      this.opts.ctx.ui.setWidget("factory", ["factory: connecting…"]);
      return;
    }
    const attn = summarizeAttention(snap);
    const working = snap.agents.filter((a) => a.state === "working").length;
    const blocked = snap.agents.filter((a) => a.state === "blocked").length;
    const settling = snap.agents.filter((a) => a.state === "settling").length;
    const unknown = snap.agents.filter((a) => a.state === "unknown").length;
    const lost = snap.agents.filter((a) => a.state === "lost").length;
    this.opts.ctx.ui.setWidget("factory", [
      `factory: w${working} b${blocked} s${settling} u${unknown} l${lost} · attn ${attn.total} · ${formatAge(snap.generatedAt)}`,
    ]);
  }

  // ------------------------------------------------------------------ ops

  private readonly ops: FactoryScreenOps = {
    moveSelection: (delta) => this.moveSelection(delta),
    pageSelection: (delta) => this.pageSelection(delta),
    openSelected: () => this.openSelected(),
    openAgents: () => this.openAgents(),
    openActions: () => {
      void this.openActions();
    },
    back: () => this.back(),
    refresh: () => {
      void this.refresh();
    },
    close: () => this.close(),
    startServer: () => {
      void this.startServer();
    },
    openQueue: () => {
      void this.openQueue();
    },
    copyLeadPrompt: () => this.copyLeadPrompt(),
  };

  private moveSelection(delta: number): void {
    switch (this.view) {
      case "board":
      case "detail": {
        if (this.flat.length === 0) return;
        this.selectedUnit = clamp(this.selectedUnit + delta, 0, this.flat.length - 1);
        this.ensureVisibleRow(this.selectedUnit);
        break;
      }
      case "agents": {
        const n = this.snapshot?.agents.length ?? 0;
        if (n > 0) this.selectedAgent = clamp(this.selectedAgent + delta, 0, n - 1);
        break;
      }
      case "actions": {
        if (this.rows.length > 0) this.selectedAction = clamp(this.selectedAction + delta, 0, this.rows.length - 1);
        break;
      }
      case "queue": {
        if (this.queueEntries.length > 0) {
          this.selectedQueue = clamp(this.selectedQueue + delta, 0, this.queueEntries.length - 1);
        }
        break;
      }
      case "action-detail":
      case "lead-prompt":
        return;
    }
    this.bump();
  }

  private pageSelection(delta: number): void {
    const step = this.view === "board" || this.view === "detail" ? Math.max(1, this.lastRegion - 2) : 8;
    this.moveSelection(delta * step);
  }

  private boardRowOf(flatIndex: number): number {
    const model = this.model;
    if (model === null) return flatIndex;
    let row = 0;
    let cursor = 0;
    for (const col of model.columns) {
      row += 1;
      for (const _unit of col.units) {
        if (cursor === flatIndex) return row;
        row += 1;
        cursor += 1;
      }
    }
    return row;
  }

  private ensureVisibleRow(flatIndex: number): void {
    if (this.view !== "board") return;
    const row = this.boardRowOf(flatIndex);
    const top = this.scroll.scrollTop;
    if (row < top) {
      this.scroll.scrollTo(row);
    } else if (row >= top + this.lastRegion) {
      this.scroll.scrollTo(row - this.lastRegion + 1);
    }
  }

  private openSelected(): void {
    switch (this.view) {
      case "board": {
        const unit = this.flat[this.selectedUnit];
        if (unit !== undefined) {
          this.prevView = "board";
          this.view = "detail";
          this.resultState = null;
          this.bump();
        }
        break;
      }
      case "agents":
        this.focusAgent();
        break;
      case "actions": {
        const row = this.rows[this.selectedAction];
        if (row !== undefined && row.ok && !this.runningAction) {
          this.preparingActions = false;
          void this.startAction(row);
        }
        break;
      }
      case "action-detail":
        if (!this.runningAction) void this.confirmExecute();
        break;
      case "queue": {
        const entry = this.queueEntries[this.selectedQueue];
        if (entry !== undefined) this.showQueueEntry(this.selectedQueue);
        break;
      }
      case "detail":
      case "lead-prompt":
        break;
    }
  }

  private focusAgent(): void {
    const agent = this.snapshot?.agents[this.selectedAgent];
    if (agent === undefined) return;
    // Native Herdr pane focus is intentionally left untouched (no public API).
    // Fall back: open the detail of the unit this agent is attached to.
    const owner = this.snapshot?.units.find((u) => u.agents.some((a) => a.label === agent.label));
    if (owner !== undefined) {
      const index = this.flat.findIndex((u) => u.id === owner.id);
      if (index >= 0) this.selectedUnit = index;
      this.view = "detail";
      this.bump();
      return;
    }
    this.opts.ctx.ui.notify(`No owning unit for agent ${agent.label} — native Herdr pane focus is untouched`, "info");
  }

  private openAgents(): void {
    if (this.snapshot === null) return;
    this.view = "agents";
    this.bump();
  }

  private prepareBody(name: string, unit: Unit): Record<string, unknown> {
    const body: Record<string, unknown> = { unit: unit.id };
    // main/merge maps to the M2 “explicit user approval” gate: the server still
    // enforces branch-ci-green and review/QA handoff preconditions, and the
    // operator must confirm via ctx.ui.confirm() before execute.
    if (name === "main/merge") body.override = true;
    return body;
  }

  private async openActions(): Promise<void> {
    if (this.view !== "detail") return;
    const unit = this.currentUnit();
    if (unit === undefined || this.snapshot === null) return;
    this.view = "actions";
    this.rows = [];
    this.selectedAction = 0;
    this.activeRow = null;
    this.resultState = null;
    this.preparingActions = true;
    const token = ++this.actionPrepToken;
    this.bump();
    const candidates: MenuCandidate[] = [
      ...candidateActions(unit, this.snapshot).map((c) => ({ ...c, kind: "action" as const })),
      ...candidateTriggers(unit, this.snapshot),
    ];
    const prepared = new Map<string, PreparedOutcome>();
    const prepareImpl = this.opts.prepareActionImpl ?? prepareAction;
    const dispatchPrepareImpl = this.opts.dispatchPrepareImpl ?? dispatchPrepare;
    for (const c of candidates) {
      try {
        if ("kind" in c && (c.kind === "dispatch" || c.kind === "skill")) {
          const trigger = c as TriggerCandidate;
          const resp = await dispatchPrepareImpl({
            unit: unit.id,
            ...(trigger.skill !== undefined ? { skill: trigger.skill } : {}),
          });
          prepared.set(c.name, { ok: resp.ok, preconditions: resp.preconditions, plan: resp.plan });
        } else {
          const resp = await prepareImpl(c.name, this.prepareBody(c.name, unit));
          prepared.set(c.name, { ok: resp.ok, preconditions: resp.preconditions, plan: resp.plan });
        }
      } catch (e) {
        prepared.set(c.name, {
          ok: false,
          preconditions: e instanceof ApiError ? e.preconditions : [],
        });
      }
      // Ignore stale resolutions if the user left the actions view or started
      // a newer prepare round while these were in flight.
      if (token !== this.actionPrepToken || this.view !== "actions") return;
    }
    if (token !== this.actionPrepToken) return;
    this.rows = buildActionMenu(candidates, prepared);
    this.preparingActions = false;
    this.bump();
  }

  private async startAction(row: ActionMenuRow): Promise<void> {
    const unit = this.currentUnit();
    if (unit === undefined) return;
    if (row.kind !== undefined && row.kind !== "action") {
      await this.startTrigger(row);
      return;
    }
    this.activeRow = row;
    this.resultState = null;
    this.view = "action-detail";
    this.runningAction = true;
    this.bump();
    try {
      const prepareImpl = this.opts.prepareActionImpl ?? prepareAction;
      const resp = await prepareImpl(row.name, this.prepareBody(row.name, unit));
      this.activeRow = {
        ...row,
        ok: resp.ok,
        reasons: resp.preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`),
        preconditions: resp.preconditions,
        plan: resp.plan,
      };
      if (resp.ok) this.preparedRequestId = resp.requestId;
    } catch (e) {
      this.activeRow = { ...row, ok: false, reasons: [errorMessage(e)], preconditions: [] };
      this.resultState = {
        kind: "error",
        message: errorMessage(e),
        preconditions: e instanceof ApiError ? e.preconditions : [],
      };
    }
    this.runningAction = false;
    this.bump();
  }

  private async startTrigger(row: ActionMenuRow): Promise<void> {
    const unit = this.currentUnit();
    if (unit === undefined) return;
    this.activeRow = row;
    this.resultState = null;
    this.view = "action-detail";
    this.runningAction = true;
    this.bump();
    try {
      const dispatchPrepareImpl = this.opts.dispatchPrepareImpl ?? dispatchPrepare;
      const resp = await dispatchPrepareImpl({
        unit: unit.id,
        ...(row.skill !== undefined ? { skill: row.skill } : {}),
      });
      this.activeRow = {
        ...row,
        ok: resp.ok,
        reasons: resp.preconditions.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`),
        preconditions: resp.preconditions,
        plan: resp.plan,
      };
      if (resp.ok) this.preparedRequestId = resp.requestId;
    } catch (e) {
      this.activeRow = { ...row, ok: false, reasons: [errorMessage(e)], preconditions: [] };
      this.resultState = {
        kind: "error",
        message: errorMessage(e),
        preconditions: e instanceof ApiError ? e.preconditions : [],
      };
    }
    this.runningAction = false;
    this.bump();
  }

  private async confirmExecute(): Promise<void> {
    const row = this.activeRow;
    if (row === null || !row.ok || this.preparedRequestId === undefined) return;
    if (row.kind !== undefined && row.kind !== "action") {
      await this.confirmEnqueue();
      return;
    }
    const planText = row.plan !== undefined
      ? (() => {
          const summary = row.plan.summary;
          if ("steps" in row.plan) {
            return `${summary}\n\n${row.plan.steps.map((s) => `$ ${s.command} ${s.args.join(" ")}`).join("\n")}`;
          }
          return summary;
        })()
      : row.label;
    const confirmed = await this.opts.ctx.ui.confirm(`${row.label} — confirm?`, planText);
    if (!confirmed) {
      this.back();
      return;
    }
    this.resultState = { kind: "running" };
    this.bump();
    try {
      const approvedBy = this.opts.ctx.sessionManager.getSessionName() ?? process.env.USER ?? "operator";
      const executeImpl = this.opts.executeActionImpl ?? executeAction;
      const result: ActionResultLike = await executeImpl(row.name, this.preparedRequestId, approvedBy);
      this.resultState = { kind: "ok", outcome: result };
    } catch (e) {
      this.resultState = e instanceof ApiError
        ? { kind: "error", message: e.message, preconditions: e.preconditions }
        : { kind: "error", message: errorMessage(e) };
    }
    this.preparedRequestId = undefined;
    this.bump();
  }

  private async confirmEnqueue(): Promise<void> {
    const row = this.activeRow;
    if (row === null || !row.ok || this.preparedRequestId === undefined) return;
    const planText =
      row.plan !== undefined
        ? (() => {
            const summary = row.plan.summary;
            const prompt = "delegationPrompt" in row.plan ? row.plan.delegationPrompt : "";
            return prompt !== "" ? `${summary}\n\n${prompt}` : summary;
          })()
        : row.label;
    const confirmed = await this.opts.ctx.ui.confirm(`${row.label} — enqueue for the Lead?`, planText);
    if (!confirmed) {
      this.back();
      return;
    }
    this.resultState = { kind: "running" };
    this.bump();
    try {
      const enqueueImpl = this.opts.dispatchEnqueueImpl ?? dispatchEnqueue;
      const { entry, prompt } = await enqueueImpl(this.preparedRequestId);
      this.activeQueueEntry = { ...entry, prompt };
      this.prevView = "actions";
      this.view = "lead-prompt";
      this.resultState = null;
      this.opts.ctx.ui.notify(`Enqueued ${entry.id} (${entry.status}) — hand to Lead`, "info");
      void this.loadQueue().catch(() => {});
    } catch (e) {
      this.resultState = e instanceof ApiError
        ? { kind: "error", message: e.message, preconditions: e.preconditions }
        : { kind: "error", message: errorMessage(e) };
    }
    this.preparedRequestId = undefined;
    this.bump();
  }

  private async openQueue(): Promise<void> {
    this.prevView = this.view === "queue" ? this.prevView : this.view;
    this.view = "queue";
    this.bump();
    try {
      await this.loadQueue();
    } catch (e) {
      this.opts.ctx.ui.notify(`queue unavailable: ${errorMessage(e)}`, "error");
    }
    this.bump();
  }

  private async loadQueue(): Promise<void> {
    const queueImpl = this.opts.dispatchQueueImpl ?? dispatchQueue;
    const res = await queueImpl();
    this.queueEntries = res.entries;
    this.selectedQueue = clamp(this.selectedQueue, 0, Math.max(0, res.entries.length - 1));
  }

  private showQueueEntry(index: number): void {
    const entry = this.queueEntries[index];
    if (entry === undefined) return;
    this.activeQueueEntry = entry;
    this.prevView = "queue";
    this.view = "lead-prompt";
    this.bump();
  }

  private copyLeadPrompt(): void {
    if (this.view !== "lead-prompt" || this.activeQueueEntry === undefined) return;
    const entry = this.activeQueueEntry;
    this.opts.ctx.ui.notify(
      `Lead prompt for ${entry.id} printed above — copy it from this pane/buffer`,
      "info",
    );
  }

  private back(): void {
    switch (this.view) {
      case "action-detail":
        this.view = "actions";
        this.activeRow = null;
        this.resultState = null;
        this.preparedRequestId = undefined;
        this.preparingActions = false;
        break;
      case "actions":
        this.view = "detail";
        this.preparingActions = false;
        break;
      case "agents":
        this.view = this.prevView === "detail" ? "detail" : "board";
        break;
      case "detail":
        this.view = "board";
        break;
      case "queue":
        this.view = "board";
        break;
      case "lead-prompt":
        this.view = this.prevView === "queue" ? "queue" : "detail";
        this.activeQueueEntry = undefined;
        break;
      case "board":
        this.close();
        return;
    }
    this.bump();
  }

  private close(): void {
    this.opts.done(undefined);
  }

  private async startServer(): Promise<void> {
    if (this.offline.serverStarted) return;
    this.offline = { ...this.offline, serverStarted: true, retrying: true };
    this.bump();
    const started = spawnControlServer(this.opts.ctx.cwd);
    if (!started.ok) {
      const next: OfflineBannerState = { ...this.offline, retrying: false };
      if (started.reason !== undefined) next.error = started.reason;
      this.offline = next;
      this.bump();
      return;
    }
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      if (await healthz()) {
        await this.refresh();
        return;
      }
    }
    this.offline = { ...this.offline, retrying: false, error: "server did not become ready in time" };
    this.bump();
  }

  // ---------------------------------------------------------------- render

  /** Marks the screen dirty and asks the TUI to repaint. */
  private bump(): void {
    if (this.disposed) return;
    this.opts.tui.requestRender();
  }

  /** No cached output: every render() recomputes from current state. */
  invalidate(): void {}

  render(width: number): string[] {
    const style = styleFromTheme(this.opts.theme);

    let headLines: string[];
    if (this.offline.error !== undefined) {
      headLines = renderOfflineBanner(this.offline, style, width);
    } else if (this.snapshot === null) {
      headLines = renderOfflineBanner({ ...this.offline, retrying: true }, style, width);
    } else {
      headLines = renderHeader(this.snapshot, style, width);
    }

    const foot = renderHelp(this.view, style, width);
    const rows = this.opts.tui.terminal?.rows ?? 24;
    const region = Math.max(4, rows - headLines.length - foot.length - 2);
    this.lastHeadLen = headLines.length;
    this.lastRegion = region;

    const body = this.renderBody(style, width);
    this.scroll.updateLayout(body.length, region, () => this.opts.tui.requestRender());
    const top = this.scroll.scrollTop;
    const visible = body.slice(top, top + region);

    return [...headLines, ...visible, ...foot].map((line) => truncateToWidth(line, width));
  }

  private renderBody(style: LineStyle, width: number): string[] {
    this.rowMap = [];
    switch (this.view) {
      case "board": {
        const model = this.model;
        if (model === null) return ["  no snapshot yet"];
        const body = renderBoardBody(model, this.selectedUnit, style, width);
        this.rebuildRowMap(body);
        return body;
      }
      case "detail": {
        const unit = this.currentUnit();
        return unit !== undefined ? renderDetail(unit, this.snapshot, style, width) : ["  no unit selected"];
      }
      case "agents": {
        const body = renderAgentsView(this.snapshot?.agents ?? [], this.selectedAgent, style, width);
        this.rebuildAgentRowMap(body);
        return body;
      }
      case "actions":
        if (this.preparingActions && this.rows.length === 0) return ["  preparing actions…"];
        return renderActionMenu(this.rows, this.selectedAction, style, width);
      case "action-detail": {
        const row = this.activeRow;
        if (row === null) return renderActionMenu(this.rows, this.selectedAction, style, width);
        return this.resultState !== null ? renderActionResult(this.resultState, style, width) : renderActionPlan(row, style, width);
      }
      case "queue":
        return renderQueueView(this.queueEntries, this.selectedQueue, style, width);
      case "lead-prompt": {
        const entry = this.activeQueueEntry;
        return entry !== undefined ? renderLeadPrompt(entry, style, width) : ["  no entry selected"];
      }
    }
  }

  private rebuildRowMap(body: string[]): void {
    const model = this.model;
    if (model === null) return;
    this.rowMap = new Array(body.length).fill(-1);
    let cursor = 0;
    let row = 0;
    for (const col of model.columns) {
      row += 1;
      for (const unit of col.units) {
        if (row < body.length) this.rowMap[row] = cursor;
        row += 1;
        cursor += 1;
      }
    }
  }

  private rebuildAgentRowMap(body: string[]): void {
    this.rowMap = new Array(body.length).fill(-1);
    const agents = this.snapshot?.agents ?? [];
    for (let i = 0; i < agents.length && i < body.length; i++) {
      this.rowMap[i] = i;
    }
  }

  // ---------------------------------------------------------------- input

  handleInput(data: string): void {
    handleKey(data, { matches: (binding) => this.opts.kb.matches(data, binding) }, this.ops);
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean; focus?: boolean; render?: boolean } | undefined {
    if (event.type === "wheel") {
      this.scroll.scrollBy(event.wheelDelta ?? 0);
      this.bump();
      return { handled: true, render: true };
    }
    if (event.type === "click" || event.type === "press") {
      const bodyY = event.y - this.lastHeadLen;
      const row = this.scroll.scrollTop + bodyY;
      if (bodyY >= 0 && bodyY < this.lastRegion && row >= 0 && row < this.rowMap.length) {
        const index = this.rowMap[row];
        if (index !== undefined && index >= 0) {
          if (this.view === "board") {
            this.selectedUnit = index;
            this.bump();
          } else if (this.view === "agents") {
            this.selectedAgent = index;
            this.bump();
          }
        }
      }
      return { handled: true, focus: true, render: true };
    }
    return undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.opts.ctx.ui.setWidget("factory", undefined);
  }
}
