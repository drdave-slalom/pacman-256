import { pathToFileURL } from "node:url";
import { buildSnapshot } from "./snapshot.ts";
import type { FactorySnapshot, Unit } from "./types.ts";

export interface CliOptions {
  json: boolean;
  root: string;
  noGh: boolean;
}

export function usage(): string {
  return [
    "factory:control — factory snapshot CLI",
    "",
    "Usage:",
    "  factory:control snapshot [--json] [--root <path>] [--no-gh]",
    "",
    "Options:",
    "  --json        print the raw snapshot as JSON",
    "  --root <path> repo root to snapshot (default: current directory)",
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
  if (command !== "snapshot") {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  const parsed = parseArgs(rest);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n\n${usage()}\n`);
    return 2;
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
