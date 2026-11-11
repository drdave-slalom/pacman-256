import { execFileSync } from "node:child_process";
import { canonicalId } from "./canonical.ts";
import type { BranchFacts, DiffTotals, RepoFacts, WorktreeFacts } from "./types.ts";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): RunResult {
  try {
    const output = execFileSync(command, args, {
      cwd: opts.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 15_000,
    });
    return { ok: true, stdout: output, stderr: "", status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number | null };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status ?? null,
    };
  }
}

function git(args: string[], opts: { cwd?: string } = {}): RunResult {
  const runOpts: { cwd?: string } = {};
  if (opts.cwd !== undefined) runOpts.cwd = opts.cwd;
  return run("git", args, runOpts);
}

export function currentBranch(repoRoot: string): string {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
  return result.ok ? result.stdout.trim() || "unknown" : "unknown";
}

export function isDirty(repoRoot: string): boolean {
  const result = git(["status", "--porcelain"], { cwd: repoRoot });
  return result.ok && result.stdout.trim() !== "";
}

export function repoFacts(repoRoot: string): RepoFacts {
  return {
    root: repoRoot,
    branch: currentBranch(repoRoot),
    dirty: isDirty(repoRoot),
  };
}

/**
 * `git diff main...<branch> --numstat` totals. Returns `undefined` when the
 * diff cannot be computed (unrelated ancestry, missing ref, git failure) —
 * per spec, base/ancestry unavailable → omit totals.
 */
export function diffTotals(repoRoot: string, branchRef: string): DiffTotals | undefined {
  const result = git(["diff", "main..." + branchRef, "--numstat"], { cwd: repoRoot });
  if (!result.ok) return undefined;
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  const totals: DiffTotals = { add: 0, del: 0, files: 0 };
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    totals.files += 1;
    totals.add += Number.parseInt(parts[0] ?? "0", 10) || 0;
    totals.del += Number.parseInt(parts[1] ?? "0", 10) || 0;
  }
  return totals;
}

/**
 * Local `factory/*` and remote-tracking `origin/factory/*` branches.
 * Remote refs surface merged/lingering branches that would otherwise vanish
 * silently (spec: orphaned artifacts are surfaced, never dropped).
 */
export function listFactoryBranches(repoRoot: string): BranchFacts[] {
  const branches: BranchFacts[] = [];

  const localResult = git(["branch", "--list", "factory/*"], { cwd: repoRoot });
  if (localResult.ok) {
    for (const raw of localResult.stdout.split(/\r?\n/)) {
      // `*` = current branch, `+` = checked out in another worktree.
      const name = raw.replace(/^[*+]?\s*/, "").trim();
      if (name === "") continue;
      branches.push({ name, canonical: canonicalId(name), remote: false });
    }
  }

  const remoteResult = git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/factory"], {
    cwd: repoRoot,
  });
  if (remoteResult.ok) {
    for (const name of remoteResult.stdout.split(/\r?\n/)) {
      if (name.trim() === "") continue;
      if (branches.some((branch) => branch.name === name.trim())) continue;
      branches.push({ name: name.trim(), canonical: canonicalId(name), remote: true });
    }
  }

  return branches;
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktrees(stdout: string): WorktreeFacts[] {
  const worktrees: WorktreeFacts[] = [];
  let current: WorktreeFacts | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (current) worktrees.push(current);
      current = undefined;
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      const match = ref.match(/^refs\/heads\/(.*)$/);
      if (current && match && match[1] !== undefined) current.branch = match[1];
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

export function listWorktrees(repoRoot: string): WorktreeFacts[] {
  const result = git(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (!result.ok) return [];
  return parseWorktrees(result.stdout);
}
