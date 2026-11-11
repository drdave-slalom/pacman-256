import { pathToFileURL } from "node:url";
import { DispatchService } from "./dispatch/service.ts";
import type { DispatchEntry } from "./dispatch/types.ts";
import { SnapshotService } from "./service.ts";
import { buildSnapshot } from "./snapshot.ts";
import type { FactorySnapshot, Unit } from "./types.ts";

export interface CliOptions {
  json: boolean;
  root: string;
  noGh: boolean;
}

export function usage(): string {
  return [
    "factory:control — factory control CLI",
    "",
    "Usage:",
    "  factory:control snapshot [--json] [--root <path>] [--no-gh]",
    "  factory:control queue [--json] [--root <path>]",
    "",
    "Commands:",
    "  snapshot  print the factory snapshot (stages, agents, PRs)",
    "  queue     list the M4 dispatch/skill queue entries (newest last)",
    "",
    "Options:",
    "  --json        print raw JSON",
    "  --root <path> repo root (default: current directory)",
    "  --no-gh      skip GitHub reads (gh fields become unavailable)",
  ].join("\n");
}

export function parseArgs(argv: string[]): CliOptions | { error: string } {
  const options: CliOptions = { json: false, root: process.cwd(), noGh: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--json") options.json = true;
    else if (arg === "--no-gh") options.noGh = true;
    else if (arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined) return { error: "--root requires a path argument" };
      options.root = value;
      i += 1;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  return options;
}

function queueLine(entry: DispatchEntry): string {
  const skill = entry.skill !== undefined ? ` skill=${entry.skill}` : "";
  const role = entry.role !== undefined ? ` role=${entry.role}` : "";
  const spec = entry.specPath !== undefined ? `  ${entry.specPath}` : "";
  return `  [${entry.status.padEnd(10)}] ${entry.id} ${entry.unit}${role}${skill}${spec}`;
}

export function queueSummary(entries: DispatchEntry[]): string {
  const lines: string[] = [];
  lines.push(`dispatch queue — ${entries.length} entries`);
  for (const entry of entries) lines.push(queueLine(entry));
  return lines.join("\n");
}

function stageLine(unit: Unit): string {
  const branch = unit.branch !== undefined ? ` branch=${unit.branch}` : "";
  const stage = unit.stage.padEnd(10);
  const attention = unit.attention.length > 0 ? ` attention=[${unit.attention.join(",")}]` : "";
  return `  [${stage}] ${unit.id}${branch}${attention}  ${unit.specPath ?? ""}`;
}

export function humanSummary(snapshot: FactorySnapshot): string {
  const lines: string[] = [];
  lines.push(`factory control — snapshot @ ${snapshot.generatedAt}`);
  lines.push(`repo: ${snapshot.repo.root} (${snapshot.repo.branch}, ${snapshot.repo.dirty ? "dirty" : "clean"})`);
  lines.push(`units (${snapshot.units.length}):`);
  for (const unit of snapshot.units) lines.push(stageLine(unit));
  lines.push(`agents (${snapshot.agents.length}):`);
  for (const agent of snapshot.agents) {
    lines.push(`  ${agent.label} [${agent.state}] (${agent.definition})`);
  }
  lines.push(`prs (${snapshot.prs.length}):`);
  for (const pr of snapshot.prs) {
    lines.push(`  #${pr.number} ${pr.state} checks=${pr.checks} ${pr.headRefName}`);
  }
  lines.push("orphaned:");
  lines.push(`  branches: ${snapshot.orphaned.branches.join(", ") || "(none)"}`);
  lines.push(`  worktrees: ${snapshot.orphaned.worktrees.join(", ") || "(none)"}`);
  lines.push(`  handoffs: ${snapshot.orphaned.handoffs.length}`);
  lines.push(`  prs: ${snapshot.orphaned.prs.length}`);
  if (snapshot.errors.length > 0) {
    lines.push("errors:");
    for (const error of snapshot.errors) lines.push(`  ${error}`);
  }
  return lines.join("\n");
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "snapshot" && command !== "queue") {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  const parsed = parseArgs(rest);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${usage()}\n`);
    return 2;
  }
  if (command === "queue") {
    const service = new SnapshotService({ root: parsed.root, noGh: parsed.noGh });
    const dispatch = new DispatchService({ snapshot: () => service.get(), factoryRoot: parsed.root });
    const entries = await dispatch.list();
    if (parsed.json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
    } else {
      process.stdout.write(queueSummary(entries) + "\n");
    }
    return 0;
  }
  const snapshot = await buildSnapshot({ root: parsed.root, noGh: parsed.noGh });
  if (parsed.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  } else {
    process.stdout.write(humanSummary(snapshot) + "\n");
  }
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const code = await runCli(process.argv.slice(2));
  process.exitCode = code;
}
