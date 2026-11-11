/**
 * M2 guarded actions: registry + service.
 *
 * The service is the only place that runs mutating commands
 * (scripts/factory-worktree.sh, npm run check, gh, git). Every action:
 *
 * 1. `prepare(action, body)` evaluates gate preconditions from a fresh
 *    snapshot, returns `{requestId, ok, preconditions, plan}`, and records an
 *    audit line. No command runs here.
 * 2. `execute(requestId, body)` requires a matching prepared request and
 *    `confirm: true`, re-evaluates the preconditions against a fresh snapshot,
 *    takes the per-unit lock (for mutating actions), runs the steps, releases
 *    the lock, and appends the audit outcome.
 *
 * The command runner is injectable so tests can record what would have run and
 * assert that denied actions never touch the underlying tools.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { canonicalId } from "../canonical.ts";
import { DispatchService, buildDelegationPrompt } from "../dispatch/service.ts";
import type { DispatchEnqueuePort, DispatchEntry } from "../dispatch/types.ts";
import type { FactorySnapshot, IssueCard } from "../types.ts";
import { guardFor, preconditionsPass } from "./preconditions.ts";
import { deriveIssueUnitId, issueRole, issueSpecPath, scaffoldSpecContent, slugifyTitle, startWorkAcceptance } from "./issue-work.ts";
import { AuditLog, type AuditLine } from "./audit.ts";
import { LockManager, type LockInfo } from "./locks.ts";
import type {
  ActionContext,
  ActionPlan,
  ActionResult,
  ActionStep,
  CommandSpec,
  ExecuteMeta,
  ExecuteRequest,
  PlanStep,
  Precondition,
  PrepareMeta,
  PrepareRequest,
} from "./types.ts";

export interface RunnerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export type CommandRunner = (spec: CommandSpec) => Promise<RunnerResult>;
export type SnapshotProvider = () => Promise<FactorySnapshot>;

/** Real subprocess runner (argv, no shell). */
export function defaultRunner(spec: CommandSpec): Promise<RunnerResult> {
  return new Promise((resolve) => {
    execFile(
      spec.command,
      spec.args,
      {
        cwd: spec.cwd,
        timeout: spec.timeoutMs ?? 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const e = error as { code?: number | null };
          resolve({
            ok: false,
            stdout: String(stdout),
            stderr: String(stderr),
            status: typeof e.code === "number" ? e.code : null,
          });
        } else {
          resolve({ ok: true, stdout: String(stdout), stderr: String(stderr), status: 0 });
        }
      },
    );
  });
}

export interface ActionDef {
  name: string;
  mutates: boolean;
  guard: (ctx: ActionContext) => Precondition[];
  plan: (ctx: ActionContext) => ActionPlan;
  steps: (ctx: ActionContext) => ActionStep[];
}

interface PreparedRecord {
  action: string;
  requestId: string;
  unitId?: string;
  prNumber?: number;
  override: boolean;
  root: boolean;
  operator: string;
  ip?: string;
  createdAt: number;
  preconditions: Precondition[];
  comment?: string;
  addLabels?: string[];
  removeLabels?: string[];
  issueState?: "close" | "reopen";
}

export interface ActionsOptions {
  factoryRoot: string;
  snapshot: SnapshotProvider;
  runner?: CommandRunner;
  audit?: AuditLog;
  locks?: LockManager;
  /** Dispatch enqueue port (start-work); defaults to a DispatchService over the same snapshot. */
  dispatch?: DispatchEnqueuePort;
  prepareTtlMs?: number;
  clock?: () => number;
}

export type PrepareOutcome =
  | { kind: "ok"; requestId: string; ok: boolean; preconditions: Precondition[]; plan: ActionPlan }
  | { kind: "unknown-action" }
  | { kind: "invalid-input"; error: string };

/** Unit ids are safe subprocess/branch/lock tokens. */
const UNIT_RE = /^[a-z0-9._-]+$/i;

function validateUnit(input: string): string | undefined {
  if (!UNIT_RE.test(input)) return undefined;
  const canon = canonicalId(input);
  return canon !== "" ? canon : undefined;
}

function validatePr(input: number): number | undefined {
  if (Number.isInteger(input) && input > 0) return input;
  return undefined;
}

function validateComment(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const text = input.trim();
  if (text === "" || text.length > 2000) return undefined;
  return text;
}

function validateLabelList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const labels: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return undefined;
    const label = raw.trim();
    if (label === "" || /[\x00-\x1f\x7f]/.test(label)) return undefined;
    labels.push(label);
  }
  return labels;
}

export type ExecuteOutcome =
  | { kind: "result"; result: ActionResult }
  | { kind: "no-prepare" }
  | { kind: "no-confirm" }
  | { kind: "preconditions"; preconditions: Precondition[] }
  | { kind: "lock"; preconditions: Precondition[] };

const DEFAULT_PREPARE_TTL_MS = 60 * 60 * 1000;

function unitOf(ctx: ActionContext): string {
  if (ctx.unitId !== undefined) return ctx.unitId;
  if (ctx.prNumber !== undefined) return `pr${ctx.prNumber}`;
  return "unit";
}

function findUnit(ctx: ActionContext): { id: string; specPath?: string; title?: string; prNumber?: number; issue?: IssueCard } | undefined {
  const unit = ctx.snapshot.units.find((candidate) => candidate.id === unitOf(ctx));
  if (unit === undefined) return undefined;
  const result: { id: string; specPath?: string; title?: string; prNumber?: number; issue?: IssueCard } = { id: unit.id };
  if (unit.specPath !== undefined) result.specPath = unit.specPath;
  if (unit.title !== undefined) result.title = unit.title;
  if (unit.pr?.number !== undefined) result.prNumber = unit.pr.number;
  if (unit.issue !== undefined) result.issue = unit.issue;
  return result;
}

function prOpenBody(unit: { id: string; specPath?: string }): string {
  const lines = [
    `Implements **${unit.id}** per the spec.`,
    "",
    `Spec: ${unit.specPath ?? "SPEC/" + unit.id + ".md"}`,
    "",
    "Factory gates:",
    "- Review: pr-reviewer handoff present",
    "- QA: qa-tester handoff present",
    "- Three-way reconciliation (spec ↔ change ↔ tests): documented in the builder handoff; `npm run check` passes.",
  ];
  return lines.join("\n");
}

function issueNumber(ctx: ActionContext): number {
  return findUnit(ctx)?.issue?.number ?? 0;
}

function ghIssueCommentStep(ctx: ActionContext, root: string): CommandSpec {
  return { command: "gh", args: ["issue", "comment", String(issueNumber(ctx)), "--body", ctx.comment ?? ""], cwd: root };
}

function ghIssueEditStep(ctx: ActionContext, root: string): CommandSpec {
  const args: string[] = ["issue", "edit", String(issueNumber(ctx))];
  for (const label of ctx.addLabels ?? []) args.push("--add-label", label);
  for (const label of ctx.removeLabels ?? []) args.push("--remove-label", label);
  return { command: "gh", args, cwd: root };
}

function ghIssueStateStep(ctx: ActionContext, root: string): CommandSpec {
  const state = ctx.issueState ?? "close";
  return { command: "gh", args: ["issue", state === "close" ? "close" : "reopen", String(issueNumber(ctx))], cwd: root };
}

function startWorkPlan(ctx: ActionContext, root: string): ActionPlan {
  const issue = findUnit(ctx)?.issue;
  if (issue === undefined) {
    return { summary: "start-work: target unit carries no GitHub issue", steps: [] };
  }
  const id = deriveIssueUnitId(issue);
  const specPath = issueSpecPath(issue);
  const role = issueRole(issue);
  const acceptance = startWorkAcceptance(id, specPath);
  const preview: DispatchEntry = {
    id: "(prepare)",
    at: "",
    unit: id,
    specPath,
    worktree: `factory/${id}`,
    role,
    acceptance,
    status: "queued",
  };
  return {
    summary: `Start work on ${id} from issue #${issue.number}: scaffold ${specPath}, create worktree factory/${id}, enqueue ${role} dispatch`,
    steps: [{ command: "scripts/factory-worktree.sh", args: ["create", id], cwd: root }],
    files: [{ path: specPath, summary: `Scaffold ${specPath} from issue #${issue.number}` }],
    prompt: buildDelegationPrompt(preview, root),
  };
}

function startWorkSteps(ctx: ActionContext, root: string): ActionStep[] {
  const issue = findUnit(ctx)?.issue;
  if (issue === undefined) return [];
  const id = deriveIssueUnitId(issue);
  const specPath = issueSpecPath(issue);
  const role = issueRole(issue);
  const acceptance = startWorkAcceptance(id, specPath);
  return [
    { kind: "write", path: specPath, content: scaffoldSpecContent(issue) },
    { command: "scripts/factory-worktree.sh", args: ["create", id], cwd: root },
    { kind: "dispatch", sourceUnit: unitOf(ctx), unit: id, specPath, worktree: `factory/${id}`, role, acceptance },
  ];
}

function buildDefs(o: ActionsOptions): Map<string, ActionDef> {
  const root = o.factoryRoot;
  const defs: ActionDef[] = [
    {
      name: "worktree/create",
      mutates: true,
      guard: (ctx) => guardFor("worktree/create", ctx),
      plan: (ctx) => ({
        summary: `Create a worktree for unit ${unitOf(ctx)} on branch factory/${unitOf(ctx)}`,
        steps: [{ command: "scripts/factory-worktree.sh", args: ["create", unitOf(ctx)], cwd: root }],
      }),
      steps: (ctx) => [{ command: "scripts/factory-worktree.sh", args: ["create", unitOf(ctx)], cwd: root }],
    },
    {
      name: "worktree/remove",
      mutates: true,
      guard: (ctx) => guardFor("worktree/remove", ctx),
      plan: (ctx) => ({
        summary: `Remove the worktree and factory/${unitOf(ctx)} branch for unit ${unitOf(ctx)}`,
        steps: [{ command: "scripts/factory-worktree.sh", args: ["remove", unitOf(ctx)], cwd: root }],
      }),
      steps: (ctx) => [{ command: "scripts/factory-worktree.sh", args: ["remove", unitOf(ctx)], cwd: root }],
    },
    {
      name: "checks/run",
      mutates: true,
      guard: (ctx) => guardFor("checks/run", ctx),
      plan: (ctx) => {
        const unit = ctx.snapshot.units.find((candidate) => candidate.id === unitOf(ctx));
        const cwd = unit?.worktree?.path ?? root;
        return {
          summary: `Run \`npm run check\` in ${unit?.worktree !== undefined ? `worktree ${cwd}` : "the repo root"}`,
          steps: [{ command: "npm", args: ["run", "check"], cwd }],
        };
      },
      steps: (ctx) => {
        const unit = ctx.snapshot.units.find((candidate) => candidate.id === unitOf(ctx));
        const cwd = unit?.worktree?.path ?? root;
        return [{ command: "npm", args: ["run", "check"], cwd }];
      },
    },
    {
      name: "pr/open",
      mutates: true,
      guard: (ctx) => guardFor("pr/open", ctx),
      plan: (ctx) => {
        const unit = findUnit(ctx);
        const title = unit?.title !== undefined ? `[${unit.id}] ${unit.title}` : `${unitOf(ctx)}: open PR`;
        return {
          summary: `Open a PR for factory/${unitOf(ctx)} → main`,
          steps: [
            {
              command: "gh",
              args: ["pr", "create", "--base", "main", "--head", `factory/${unitOf(ctx)}`, "--title", title, "--body", prOpenBody(unit ?? { id: unitOf(ctx) })],
              cwd: root,
            },
          ],
        };
      },
      steps: (ctx) => {
        const unit = findUnit(ctx);
        const title = unit?.title !== undefined ? `[${unit.id}] ${unit.title}` : `${unitOf(ctx)}: open PR`;
        return [
          {
            command: "gh",
            args: ["pr", "create", "--base", "main", "--head", `factory/${unitOf(ctx)}`, "--title", title, "--body", prOpenBody(unit ?? { id: unitOf(ctx) })],
            cwd: root,
          },
        ];
      },
    },
    {
      name: "checks/query",
      mutates: false,
      guard: (ctx) => guardFor("checks/query", ctx),
      plan: (ctx) => {
        const number = ctx.prNumber ?? ctx.snapshot.units.find((candidate) => candidate.id === unitOf(ctx))?.pr?.number;
        return {
          summary: `Poll check state for PR #${number ?? "?"}`,
          steps: [
            {
              command: "gh",
              args: ["pr", "checks", String(number ?? ""), "--json", "state,bucket,name,workflow"],
              cwd: root,
            },
          ],
        };
      },
      steps: (ctx) => {
        const number = ctx.prNumber ?? ctx.snapshot.units.find((candidate) => candidate.id === unitOf(ctx))?.pr?.number;
        return [
          {
            command: "gh",
            args: ["pr", "checks", String(number ?? ""), "--json", "state,bucket,name,workflow"],
            cwd: root,
          },
        ];
      },
    },
    {
      name: "pr/merge",
      mutates: true,
      guard: (ctx) => guardFor("pr/merge", ctx),
      plan: (ctx) => {
        const unit = findUnit(ctx);
        return {
          summary: `Merge PR #${unit?.prNumber ?? "?"} (factory/${unitOf(ctx)}) with --merge`,
          steps: [
            { command: "gh", args: ["pr", "merge", String(unit?.prNumber ?? ""), "--merge"], cwd: root },
          ],
        };
      },
      steps: (ctx) => {
        const unit = findUnit(ctx);
        return [
          { command: "gh", args: ["pr", "merge", String(unit?.prNumber ?? ""), "--merge"], cwd: root },
        ];
      },
    },
    {
      name: "main/merge",
      mutates: true,
      guard: (ctx) => guardFor("main/merge", ctx),
      plan: (ctx) => ({
        summary: `Directly merge factory/${unitOf(ctx)} into main (explicit user approval)`,
        steps: [
          { command: "git", args: ["fetch", "origin"], cwd: root },
          { command: "git", args: ["diff", "--quiet", "HEAD"], cwd: root },
          { command: "git", args: ["checkout", "main"], cwd: root },
          { command: "git", args: ["merge", "--no-ff", `factory/${unitOf(ctx)}`], cwd: root },
          { command: "git", args: ["push", "origin", "main"], cwd: root },
        ],
      }),
      steps: (ctx) => [
        { command: "git", args: ["fetch", "origin"], cwd: root },
        { command: "git", args: ["diff", "--quiet", "HEAD"], cwd: root },
        { command: "git", args: ["checkout", "main"], cwd: root },
        { command: "git", args: ["merge", "--no-ff", `factory/${unitOf(ctx)}`], cwd: root },
        { command: "git", args: ["push", "origin", "main"], cwd: root },
      ],
    },
    {
      name: "github/issue-comment",
      mutates: true,
      guard: (ctx) => guardFor("github/issue-comment", ctx),
      plan: (ctx) => {
        const n = issueNumber(ctx);
        const raw = ctx.comment ?? "";
        const excerpt = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
        return {
          summary: `Comment on GitHub issue #${n}: ${excerpt}`,
          steps: [ghIssueCommentStep(ctx, root)],
        };
      },
      steps: (ctx) => [ghIssueCommentStep(ctx, root)],
    },
    {
      name: "github/issue-label",
      mutates: true,
      guard: (ctx) => guardFor("github/issue-label", ctx),
      plan: (ctx) => {
        const n = issueNumber(ctx);
        const add = ctx.addLabels ?? [];
        const remove = ctx.removeLabels ?? [];
        const summary: string[] = [`Update GitHub issue #${n} labels`];
        if (add.length > 0) summary.push(`+${add.join(",+")}`);
        if (remove.length > 0) summary.push(`-${remove.join(",-")}`);
        return { summary: summary.join(" "), steps: [ghIssueEditStep(ctx, root)] };
      },
      steps: (ctx) => [ghIssueEditStep(ctx, root)],
    },
    {
      name: "github/issue-state",
      mutates: true,
      guard: (ctx) => guardFor("github/issue-state", ctx),
      plan: (ctx) => {
        const n = issueNumber(ctx);
        const close = (ctx.issueState ?? "close") === "close";
        return {
          summary: close ? `Close GitHub issue #${n}` : `Reopen GitHub issue #${n}`,
          steps: [ghIssueStateStep(ctx, root)],
        };
      },
      steps: (ctx) => [ghIssueStateStep(ctx, root)],
    },
    {
      name: "factory/start-work",
      mutates: true,
      guard: (ctx) => guardFor("factory/start-work", ctx),
      plan: (ctx) => startWorkPlan(ctx, root),
      steps: (ctx) => startWorkSteps(ctx, root),
    },
  ]
  return new Map(defs.map((def) => [def.name, def]));
}

export class ActionsService {
  private readonly o: ActionsOptions;
  private readonly defs: Map<string, ActionDef>;
  private readonly audit: AuditLog;
  private readonly locks: LockManager;
  private readonly runner: CommandRunner;
  private readonly dispatch: DispatchEnqueuePort;
  private readonly prepared = new Map<string, PreparedRecord>();
  private readonly now: () => number;

  constructor(o: ActionsOptions) {
    this.o = o;
    this.defs = buildDefs(o);
    this.runner = o.runner ?? defaultRunner;
    this.audit =
      o.audit ??
      new AuditLog({ file: join(o.factoryRoot, "factory-control", "state", "audit.log.jsonl") });
    this.locks = o.locks ?? new LockManager({ dir: join(o.factoryRoot, "factory-control", "state", "locks") });
    this.dispatch = o.dispatch ?? new DispatchService({ snapshot: o.snapshot, factoryRoot: o.factoryRoot });
    this.now = o.clock ?? (() => Date.now());
  }

  listActions(): string[] {
    return [...this.defs.keys()];
  }

  async prepare(action: string, req: PrepareRequest, meta: PrepareMeta): Promise<PrepareOutcome> {
    const def = this.defs.get(action);
    if (def === undefined) return { kind: "unknown-action" };
    const snapshot = await this.o.snapshot();
    const ctx: ActionContext = {
      snapshot,
      override: req.override === true,
      root: req.root === true,
    };
    const unit = req.unit !== undefined ? validateUnit(req.unit) : undefined;
    if (req.unit !== undefined && unit === undefined) {
      return { kind: "invalid-input", error: `invalid unit: ${JSON.stringify(req.unit)}` };
    }
    const pr = req.pr !== undefined ? validatePr(req.pr) : undefined;
    if (req.pr !== undefined && pr === undefined) {
      return { kind: "invalid-input", error: "invalid pr: must be a positive integer" };
    }
    if (unit !== undefined) ctx.unitId = unit;
    if (pr !== undefined) ctx.prNumber = pr;

    let comment: string | undefined;
    let addLabels: string[] | undefined;
    let removeLabels: string[] | undefined;
    let issueState: "close" | "reopen" | undefined;
    if (def.name === "github/issue-comment") {
      const c = validateComment(req.comment);
      if (c === undefined) {
        return { kind: "invalid-input", error: "comment is required (non-empty string, ≤2000 chars)" };
      }
      comment = c;
    } else if (def.name === "github/issue-label") {
      if (req.addLabels !== undefined) {
        const a = validateLabelList(req.addLabels);
        if (a === undefined) {
          return { kind: "invalid-input", error: "addLabels must be an array of non-empty label strings" };
        }
        addLabels = a;
      }
      if (req.removeLabels !== undefined) {
        const r = validateLabelList(req.removeLabels);
        if (r === undefined) {
          return { kind: "invalid-input", error: "removeLabels must be an array of non-empty label strings" };
        }
        removeLabels = r;
      }
      if ((addLabels === undefined || addLabels.length === 0) && (removeLabels === undefined || removeLabels.length === 0)) {
        return { kind: "invalid-input", error: "issue-label requires at least one addLabels/removeLabels label" };
      }
    } else if (def.name === "github/issue-state") {
      if (req.state === undefined) {
        issueState = "close";
      } else if (typeof req.state !== "string") {
        return { kind: "invalid-input", error: 'state must be "close" or "reopen"' };
      } else {
        const state = req.state.toLowerCase();
        if (state !== "close" && state !== "reopen") {
          return { kind: "invalid-input", error: 'state must be "close" or "reopen"' };
        }
        issueState = state;
      }
    }
    if (comment !== undefined) ctx.comment = comment;
    if (addLabels !== undefined) ctx.addLabels = addLabels;
    if (removeLabels !== undefined) ctx.removeLabels = removeLabels;
    if (issueState !== undefined) ctx.issueState = issueState;

    const preconditions = def.guard(ctx);
    const plan = def.plan(ctx);
    const requestId = randomUUID();
    const requestOperator = req.operator?.trim() !== "" ? req.operator : undefined;
    const operator = requestOperator ?? meta.operator ?? "unknown";
    this.prune();

    const record: PreparedRecord = {
      action,
      requestId,
      override: ctx.override,
      root: ctx.root,
      operator,
      createdAt: this.now(),
      preconditions,
    };
    if (ctx.unitId !== undefined) record.unitId = ctx.unitId;
    if (ctx.prNumber !== undefined) record.prNumber = ctx.prNumber;
    if (ctx.comment !== undefined) record.comment = ctx.comment;
    if (ctx.addLabels !== undefined) record.addLabels = ctx.addLabels;
    if (ctx.removeLabels !== undefined) record.removeLabels = ctx.removeLabels;
    if (ctx.issueState !== undefined) record.issueState = ctx.issueState;
    if (meta.ip !== undefined) record.ip = meta.ip;
    this.prepared.set(requestId, record);

    const line: Omit<AuditLine, "at"> = {
      action,
      requestId,
      operator,
      preconditions,
      outcome: "prepared",
    };
    if (meta.ip !== undefined) line.ip = meta.ip;
    if (ctx.unitId !== undefined) line.unit = ctx.unitId;
    if (ctx.prNumber !== undefined) line.pr = ctx.prNumber;
    this.audit.append(line);

    return {
      kind: "ok",
      requestId,
      ok: preconditionsPass(preconditions),
      preconditions,
      plan,
    };
  }

  async execute(requestId: string, req: ExecuteRequest, meta: ExecuteMeta): Promise<ExecuteOutcome> {
    const rec = this.prepared.get(requestId);
    if (rec === undefined) return { kind: "no-prepare" };
    if (req.confirm !== true) return { kind: "no-confirm" };
    const def = this.defs.get(rec.action);
    if (def === undefined) {
      this.prepared.delete(requestId);
      return { kind: "no-prepare" };
    }
    // Strict one-shot: claim the record before any await so concurrent
    // duplicate executes cannot both run the same requestId. The `finally`
    // below remains as a safety net.
    this.prepared.delete(requestId);
    const approvedOperator = req.approvedBy?.trim() !== "" ? req.approvedBy : undefined;
    const operator = approvedOperator ?? rec.operator;
    try {
      const snapshot = await this.o.snapshot();
      const ctx: ActionContext = {
        snapshot,
        override: rec.override,
        root: rec.root,
      };
      if (rec.unitId !== undefined) ctx.unitId = rec.unitId;
      if (rec.prNumber !== undefined) ctx.prNumber = rec.prNumber;
      if (rec.comment !== undefined) ctx.comment = rec.comment;
      if (rec.addLabels !== undefined) ctx.addLabels = rec.addLabels;
      if (rec.removeLabels !== undefined) ctx.removeLabels = rec.removeLabels;
      if (rec.issueState !== undefined) ctx.issueState = rec.issueState;
      const preconditions = def.guard(ctx);
      if (!preconditionsPass(preconditions)) {
        this.audit.append(this.auditLine(rec, operator, meta, preconditions, "rejected"));
        return { kind: "preconditions", preconditions };
      }

      if (def.mutates) {
        const lockUnit = rec.unitId ?? (rec.prNumber !== undefined ? `pr${rec.prNumber}` : rec.action);
        const acquired = this.locks.tryAcquire(
          lockUnit,
          { unit: lockUnit, requestId, operator, acquiredAt: this.now(), pid: process.pid },
          { override: rec.override },
        );
        if (!acquired.ok) {
          const preconditions: Precondition[] = [{ name: "lock", ok: false, detail: acquired.reason }];
          this.audit.append(this.auditLine(rec, operator, meta, preconditions, "rejected"));
          return { kind: "lock", preconditions };
        }
        try {
          const result = await this.runSteps(def, ctx, requestId);
          this.audit.append(this.auditLine(rec, operator, meta, preconditions, result.outcome, result.exit));
          return { kind: "result", result };
        } finally {
          this.locks.release(lockUnit);
        }
      }

      const result = await this.runSteps(def, ctx, requestId);
      this.audit.append(this.auditLine(rec, operator, meta, preconditions, result.outcome, result.exit));
      return { kind: "result", result };
    } finally {
      this.prepared.delete(requestId);
    }
  }

  recentAudit(limit: number): AuditLine[] {
    return this.audit.recent(limit);
  }

  locksList() {
    return this.locks.list();
  }

  lockStale(info: LockInfo) {
    return this.locks.isStale(info);
  }

  private auditLine(
    rec: PreparedRecord,
    operator: string,
    meta: ExecuteMeta,
    preconditions: Precondition[],
    outcome: "success" | "failed" | "rejected",
    exit?: number | null,
  ): Omit<AuditLine, "at"> {
    const line: Omit<AuditLine, "at"> = {
      action: rec.action,
      requestId: rec.requestId,
      operator,
      preconditions,
      outcome,
    };
    const ip = meta.ip ?? rec.ip;
    if (ip !== undefined) line.ip = ip;
    if (rec.unitId !== undefined) line.unit = rec.unitId;
    if (rec.prNumber !== undefined) line.pr = rec.prNumber;
    if (exit !== undefined && exit !== null) line.exit = exit;
    return line;
  }

  private async runSteps(def: ActionDef, ctx: ActionContext, requestId: string): Promise<ActionResult> {
    const steps: ActionStep[] = def.steps(ctx);
    const commands: string[] = [];
    const tails: string[] = [];
    let exit: number | null = null;
    let failed = false;
    let prompt: string | undefined;
    for (const step of steps) {
      if ("kind" in step) {
        if (step.kind === "write") {
          commands.push(`write ${step.path}`);
          try {
            const abs = join(this.o.factoryRoot, step.path);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, step.content, "utf8");
            exit = 0;
          } catch (error) {
            exit = 1;
            failed = true;
            tails.push(error instanceof Error ? error.message : String(error));
            break;
          }
        } else if (step.kind === "dispatch") {
          commands.push(`dispatch enqueue ${step.unit}`);
          const outcome = await this.dispatch.enqueueStartWork({
            sourceUnit: step.sourceUnit,
            unit: step.unit,
            specPath: step.specPath,
            worktree: step.worktree,
            role: step.role,
            acceptance: step.acceptance,
          });
          if (outcome.kind !== "ok") {
            exit = 1;
            failed = true;
            tails.push(`dispatch enqueue rejected: ${outcome.reason}`);
            break;
          }
          prompt = outcome.prompt;
          if (prompt !== "") tails.push(prompt);
          exit = 0;
        }
        continue;
      }
      commands.push([step.command, ...step.args].join(" "));
      const result = await this.runner(step);
      if (result.stdout !== "") tails.push(result.stdout);
      if (result.stderr !== "") tails.push(result.stderr);
      if (!result.ok) {
        exit = result.status ?? 1;
        failed = true;
        break;
      }
      exit = 0;
    }
    const result: ActionResult = {
      requestId,
      outcome: failed ? "failed" : "success",
      command: commands,
      exit,
      outputTail: tails.join("\n").slice(-4000),
    };
    if (prompt !== undefined) result.prompt = prompt;
    return result;
  }

  private prune(): void {
    const ttl = this.o.prepareTtlMs ?? DEFAULT_PREPARE_TTL_MS;
    const cutoff = this.now() - ttl;
    for (const [id, rec] of this.prepared) {
      if (rec.createdAt < cutoff) this.prepared.delete(id);
    }
  }
}
