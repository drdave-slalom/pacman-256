/**
 * M4 dispatch/skill trigger service.
 *
 * This service is deliberately inert: it never spawns agents, never runs
 * skills, and never executes commands. It validates a request against the
 * snapshot, records a structured queue entry, and lets the Lead (or snapshot
 * evidence) advance it. The only side effects are append-only writes to the
 * dispatch-queue state directory.
 *
 * Hardening (S1/S2):
 * - S1: `enqueue` is gated on the prepare's `ok` AND re-checks the snapshot
 *   preconditions at enqueue (mirroring M2 execute's fresh re-check), closing
 *   the prepare→enqueue TOCTOU.
 * - S2: only one active (queued/dispatched) entry per unit — a second
 *   prepare/enqueue for the same unit is rejected until the entry reaches a
 *   terminal state (done/cancelled).
 */

import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { canonicalId } from "../canonical.ts";
import type { AgentRecord, FactorySnapshot, Unit } from "../types.ts";
import { DispatchQueue } from "./queue.ts";
import { skillById } from "./skills.ts";
import type {
  DispatchEntry,
  DispatchPlan,
  DispatchPrepareRequest,
  DispatchStatus,
  PrepareMeta,
} from "./types.ts";

const UNIT_RE = /^[a-z0-9._-]+$/i;
const DEFAULT_PREPARE_TTL_MS = 60 * 60 * 1000;

const ACTING_STATES = new Set(["working", "blocked", "settling", "starting"]);

function isActingAgent(agent: AgentRecord): boolean {
  return ACTING_STATES.has(agent.state);
}

function hasLiveAgent(unit: Unit): boolean {
  return unit.agents.some(isActingAgent);
}

function hasHandoff(unit: Unit): boolean {
  return unit.handoffs.length > 0;
}

function branchExistsForUnit(snapshot: FactorySnapshot, unit: Unit): boolean {
  if (unit.branch !== undefined) return true;
  return snapshot.orphaned.branches.some((branch) => canonicalId(branch) === unit.id);
}

function findUnit(snapshot: FactorySnapshot, id: string): Unit | undefined {
  const canon = canonicalId(id);
  return snapshot.units.find((unit) => unit.id === canon);
}

interface Precondition {
  name: string;
  ok: boolean;
  detail: string;
}

function ok(name: string, detail: string): Precondition {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): Precondition {
  return { name, ok: false, detail };
}

function preconditionsPass(preconditions: Precondition[]): boolean {
  return preconditions.every((precondition) => precondition.ok);
}

interface PreparedRecord {
  requestId: string;
  entryId: string;
  operator?: string;
  createdAt: number;
  /** Whether prepare passed its preconditions (fast gate for enqueue). */
  ok: boolean;
  preconditions: Precondition[];
  entry: DispatchEntry;
}

export type DispatchPrepareOutcome =
  | { kind: "ok"; requestId: string; entryId: string; ok: boolean; preconditions: Precondition[]; plan: DispatchPlan }
  | { kind: "invalid-input"; error: string }
  | { kind: "unknown-unit" }
  | { kind: "unknown-skill" }
  | { kind: "active-entry"; error: string };

export type DispatchEnqueueOutcome =
  | { kind: "ok"; entry: DispatchEntry; prompt: string }
  | { kind: "no-prepare" }
  | { kind: "rejected"; reason: string; preconditions?: Precondition[] };

export type DispatchStatusOutcome =
  | { kind: "ok"; entry: DispatchEntry }
  | { kind: "not-found" }
  | { kind: "invalid-status" }
  | { kind: "invalid-transition"; reason: string };

export interface DispatchServiceOptions {
  factoryRoot: string;
  snapshot: () => Promise<FactorySnapshot>;
  queue?: DispatchQueue;
  prepareTtlMs?: number;
  clock?: () => number;
}

function worktreePathOf(factoryRoot: string, unit: string): string {
  return join(dirname(factoryRoot), `${basename(factoryRoot)}-wt-${unit}`);
}

/** The ready-to-paste delegation prompt for the Lead. */
export function buildDelegationPrompt(entry: DispatchEntry, factoryRoot: string): string {
  const specPath = entry.specPath ?? `SPEC/${entry.unit}.md`;
  const worktree = entry.worktree ?? `factory/${entry.unit}`;
  const wtPath = worktreePathOf(factoryRoot, entry.unit);
  const role = entry.role ?? "builder";
  const acceptance = entry.acceptance ?? `Complete ${entry.unit} per ${specPath}; report a handoff.`;
  const isSkill = entry.skill !== undefined;

  const task = isSkill
    ? `Run the ${entry.skill} skill for unit ${entry.unit} per ${specPath} in worktree ${wtPath} (branch ${worktree}). Acceptance: ${acceptance}`
    : `Implement unit ${entry.unit} per ${specPath} inside the assigned worktree ${wtPath} (cd into it first; verify with git rev-parse --show-toplevel). Acceptance: ${acceptance} Do not commit/push unless authorized.`;

  const files = new Set<string>([specPath]);
  for (const ref of entry.contextRefs ?? []) files.add(ref);

  const lines: string[] = [
    `LEAD DELEGATION PROMPT — queue ${entry.id}`,
    "====================================",
    `Unit:       ${entry.unit}`,
    `Spec:       ${specPath}`,
    `Worktree:   ${wtPath}   (branch ${worktree})`,
    `Role:       ${role}`,
    `Queued:     ${entry.at} · status ${entry.status}`,
  ];
  if (entry.skill !== undefined) lines.push(`Skill:      ${entry.skill}`);
  if (entry.contextRefs !== undefined && entry.contextRefs.length > 0) {
    lines.push(`Context:    ${entry.contextRefs.join(", ")}`);
  }
  lines.push(
    "",
    "Acceptance:",
    `  ${acceptance}`,
    "",
    "Dispatch in your pi session with the standard delegation tools, e.g.:",
    "",
    "delegate_agent({",
    `  definition: "${role}",`,
    `  task: "${task}",`,
    `  files: [${[...files].map((f) => JSON.stringify(f)).join(", ")}],`,
    "})",
  );
  return lines.join("\n");
}

export class DispatchService {
  private readonly o: DispatchServiceOptions;
  private readonly queue: DispatchQueue;
  private readonly prepared = new Map<string, PreparedRecord>();
  private readonly now: () => number;

  constructor(o: DispatchServiceOptions) {
    this.o = o;
    this.queue =
      o.queue ??
      new DispatchQueue({ dir: join(o.factoryRoot, "factory-control", "state", "dispatch-queue") });
    this.now = o.clock ?? (() => Date.now());
  }

  async prepare(req: DispatchPrepareRequest, meta: PrepareMeta): Promise<DispatchPrepareOutcome> {
    const unitInput = req.unit;
    if (typeof unitInput !== "string" || !UNIT_RE.test(unitInput)) {
      return { kind: "invalid-input", error: `invalid unit: ${JSON.stringify(unitInput)}` };
    }
    const canon = canonicalId(unitInput);
    if (canon === "") {
      return { kind: "invalid-input", error: `invalid unit: ${JSON.stringify(unitInput)}` };
    }
    const snapshot = await this.o.snapshot();
    const unit = findUnit(snapshot, canon);
    if (unit === undefined) return { kind: "unknown-unit" };

    const skillInput = req.skill;
    if (skillInput !== undefined && typeof skillInput !== "string") {
      return { kind: "invalid-input", error: "skill must be a string" };
    }
    const skill = skillInput !== undefined ? skillById(skillInput) : undefined;
    if (skillInput !== undefined && skill === undefined) return { kind: "unknown-skill" };

    // S2: one active request per unit — a queued/dispatched entry blocks a
    // second prepare for the same unit.
    if (this.queue.hasActive(unit.id)) {
      return {
        kind: "active-entry",
        error: `an active dispatch/skill entry already exists for unit ${unit.id}`,
      };
    }

    const preconditions = this.gatePreconditions(snapshot, unit, skill?.id);
    const plan = skill !== undefined ? this.skillPlan(skill, unit) : this.dispatchPlan(unit);

    const requestId = randomUUID();
    const entryId = `req-${requestId.slice(0, 8)}`;
    const record: PreparedRecord = {
      requestId,
      entryId,
      createdAt: this.now(),
      ok: preconditionsPass(preconditions),
      preconditions,
      entry: {
        id: entryId,
        at: new Date(this.now()).toISOString(),
        unit: unit.id,
        ...(plan.specPath !== undefined ? { specPath: plan.specPath } : {}),
        worktree: plan.worktree,
        role: plan.role,
        acceptance: plan.acceptance,
        ...(plan.skill !== undefined ? { skill: plan.skill } : {}),
        ...(plan.contextRefs !== undefined ? { contextRefs: plan.contextRefs } : {}),
        status: "queued",
      },
    };
    const operator = meta.operator?.trim() !== "" ? meta.operator : undefined;
    if (operator !== undefined) record.operator = operator;
    this.prune();
    this.prepared.set(requestId, record);

    return {
      kind: "ok",
      requestId,
      entryId: record.entryId,
      ok: record.ok,
      preconditions,
      plan,
    };
  }

  async enqueue(requestId: string): Promise<DispatchEnqueueOutcome> {
    const rec = this.prepared.get(requestId);
    if (rec === undefined) return { kind: "no-prepare" };
    this.prepared.delete(requestId); // one-shot

    // S1 gate: never enqueue a request whose prepare failed preconditions.
    if (!rec.ok) {
      return {
        kind: "rejected",
        reason: "prepare did not pass preconditions",
        preconditions: rec.preconditions,
      };
    }

    // S1 TOCTOU close: re-check the snapshot preconditions now (mirroring M2
    // execute's fresh re-check), so a unit that gained a writer/worktree/branch/
    // live-agent between prepare and enqueue cannot be enqueued.
    const snapshot = await this.o.snapshot();
    const unit = findUnit(snapshot, rec.entry.unit);
    if (unit === undefined) {
      return { kind: "rejected", reason: `unit ${rec.entry.unit} no longer present in the snapshot` };
    }
    if (this.queue.hasActive(unit.id)) {
      return {
        kind: "rejected",
        reason: `an active dispatch/skill entry already exists for unit ${unit.id}`,
      };
    }
    const preconditions = this.gatePreconditions(snapshot, unit, rec.entry.skill);
    if (!preconditionsPass(preconditions)) {
      return {
        kind: "rejected",
        reason: "preconditions failed at enqueue (state changed since prepare)",
        preconditions,
      };
    }

    const entry = this.queue.append(rec.entry);
    return { kind: "ok", entry, prompt: buildDelegationPrompt(entry, this.o.factoryRoot) };
  }

  /** List entries (newest last), applying snapshot evidence first. */
  async list(): Promise<DispatchEntry[]> {
    const snapshot = await this.o.snapshot();
    this.applyEvidence(snapshot);
    return this.queue.list();
  }

  async status(id: string, next: unknown): Promise<DispatchStatusOutcome> {
    if (typeof id !== "string" || id === "") return { kind: "not-found" };
    if (typeof next !== "string" || !["queued", "dispatched", "done", "cancelled"].includes(next)) {
      return { kind: "invalid-status" };
    }
    const snapshot = await this.o.snapshot();
    this.applyEvidence(snapshot);
    const outcome = this.queue.transition(id, next as DispatchStatus);
    if (!outcome.ok) return { kind: "invalid-transition", reason: outcome.reason };
    return { kind: "ok", entry: outcome.entry };
  }

  prompt(id: string): string | undefined {
    const entry = this.queue.find(id);
    if (entry === undefined) return undefined;
    return buildDelegationPrompt(entry, this.o.factoryRoot);
  }

  /**
   * Server-side evidence automation. A live agent matching the unit moves a
   * queued entry to `dispatched`; a handoff present on the unit closes it to
   * `done`. Never runs commands, never spawns anything.
   */
  private applyEvidence(snapshot: FactorySnapshot): void {
    for (const entry of this.queue.list()) {
      const unit = findUnit(snapshot, entry.unit);
      if (unit === undefined) continue;
      if (hasHandoff(unit) && (entry.status === "queued" || entry.status === "dispatched")) {
        this.queue.evidence(entry.id, "done");
        continue;
      }
      if (hasLiveAgent(unit) && entry.status === "queued") {
        this.queue.evidence(entry.id, "dispatched");
      }
    }
  }

  /**
   * Shared precondition gate for dispatch and skill requests (used by prepare
   * and by enqueue's fresh re-check).
   */
  private gatePreconditions(snapshot: FactorySnapshot, unit: Unit, skill?: string): Precondition[] {
    if (skill !== undefined) {
      const def = skillById(skill);
      if (def === undefined) {
        return [fail("skill-eligible", `unknown skill: ${skill}`)];
      }
      return [
        ok("unit-found", `unit ${unit.id} found in snapshot`),
        def.eligible(unit)
          ? ok("skill-eligible", `${def.id} is eligible for ${unit.id} (stage ${unit.stage})`)
          : fail("skill-eligible", `${def.id} is not eligible for ${unit.id} (stage ${unit.stage})`),
      ];
    }
    const specOk = unit.specPath !== undefined;
    const worktreeOk = unit.worktree === undefined;
    const branchOk = !branchExistsForUnit(snapshot, unit);
    const agentOk = !hasLiveAgent(unit);
    return [
      ok("unit-found", `unit ${unit.id} found in snapshot`),
      specOk ? ok("spec-exists", "unit has a SPEC file") : fail("spec-exists", "unit has no SPEC file in the snapshot"),
      worktreeOk ? ok("no-worktree", `no worktree exists for ${unit.id}`) : fail("no-worktree", `a worktree already exists: ${unit.worktree?.path}`),
      branchOk ? ok("no-branch", `no factory/${unit.id} branch exists`) : fail("no-branch", `a factory/${unit.id} branch already exists`),
      agentOk ? ok("no-live-agent", "no live agent acting on this unit") : fail("no-live-agent", "a live agent is still acting on this unit"),
    ];
  }

  private dispatchPlan(unit: Unit): DispatchPlan {
    const specPath = unit.specPath;
    const worktree = `factory/${unit.id}`;
    const worktreePath = worktreePathOf(this.o.factoryRoot, unit.id);
    const acceptance = [
      `Implement ${unit.id} per ${specPath};`,
      "npm run check passes in the worktree;",
      "builder handoff present;",
      "QA (qa-tester) and review (pr-reviewer) handoffs before any PR/merge;",
      "three-way reconciliation (spec ↔ change ↔ tests) documented.",
    ].join(" ");
    return {
      kind: "dispatch",
      unit: unit.id,
      role: "builder",
      worktree,
      worktreePath,
      ...(specPath !== undefined ? { specPath } : {}),
      acceptance,
      summary: `Dispatch ${unit.id} to a builder agent in worktree ${worktreePath} (branch ${worktree})`,
      delegationPrompt: this.promptFor({
        id: "(prepare)",
        at: new Date(this.now()).toISOString(),
        unit: unit.id,
        worktree,
        role: "builder",
        acceptance,
        ...(specPath !== undefined ? { specPath } : {}),
        status: "queued",
      }),
    };
  }

  private skillPlan(
    skill: { id: string; label: string; skillPath: string; role: string; acceptance(unit: Unit): string; contextRefs(unit: Unit): string[] },
    unit: Unit,
  ): DispatchPlan {
    const specPath = unit.specPath;
    const worktree = `factory/${unit.id}`;
    const worktreePath = unit.worktree?.path ?? worktreePathOf(this.o.factoryRoot, unit.id);
    const contextRefs = skill.contextRefs(unit);
    const acceptance = skill.acceptance(unit);
    return {
      kind: "skill",
      unit: unit.id,
      role: skill.role,
      worktree,
      worktreePath,
      ...(specPath !== undefined ? { specPath } : {}),
      skill: skill.id,
      skillPath: skill.skillPath,
      contextRefs,
      acceptance,
      summary: `Run the ${skill.id} skill for ${unit.id} (${skill.label}) — role ${skill.role}`,
      delegationPrompt: this.promptFor({
        id: "(prepare)",
        at: new Date(this.now()).toISOString(),
        unit: unit.id,
        worktree,
        role: skill.role,
        acceptance,
        ...(specPath !== undefined ? { specPath } : {}),
        ...(skill.id !== undefined ? { skill: skill.id } : {}),
        ...(contextRefs.length > 0 ? { contextRefs } : {}),
        status: "queued",
      }),
    };
  }

  private promptFor(entry: DispatchEntry): string {
    return buildDelegationPrompt(entry, this.o.factoryRoot);
  }

  private prune(): void {
    const ttl = this.o.prepareTtlMs ?? DEFAULT_PREPARE_TTL_MS;
    const cutoff = this.now() - ttl;
    for (const [id, rec] of this.prepared) {
      if (rec.createdAt < cutoff) this.prepared.delete(id);
    }
  }
}
