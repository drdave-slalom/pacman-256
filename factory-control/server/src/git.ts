import { spawn, type ChildProcess } from "node:child_process";
import { canonicalId } from "./canonical.ts";
import { ghTimeoutMs } from "./config.ts";
import type { BranchFacts, DiffTotals, RepoFacts, WorktreeFacts } from "./types.ts";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  /** True when the child was killed by the per-child timeout. */
  timedOut?: boolean;
}

/**
 * Run a child process asynchronously (never blocking the event loop).
 * Resolves with a `RunResult`; failures (non-zero exit, spawn error, or
 * timeout) are reported in-band rather than thrown.
 */
export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  // Per-child timeout (spec: 10–15s; default 15s, configurable via
  // FACTORY_GH_TIMEOUT_MS) — a wedged gh/git child must never freeze the
  // server; it is killed and the read degrades.
  const timeoutMs = opts.timeoutMs ?? ghTimeoutMs();
  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        status: null,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, stdout, stderr, status: null, timedOut: true });
        return;
      }
      resolve({ ok: false, stdout, stderr: stderr === "" ? error.message : stderr, status: null });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, stdout, stderr, status: null, timedOut: true });
        return;
      }
      resolve({ ok: code === 0, stdout, stderr, status: code });
    });
  });
}

async function git(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  const runOpts: { cwd?: string } = {};
  if (opts.cwd !== undefined) runOpts.cwd = opts.cwd;
  return run("git", args, runOpts);
}

export async function currentBranch(repoRoot: string): Promise<string> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
  return result.ok ? result.stdout.trim() || "unknown" : "unknown";
}

export async function isDirty(repoRoot: string): Promise<boolean> {
  const result = await git(["status", "--porcelain"], { cwd: repoRoot });
  return result.ok && result.stdout.trim() !== "";
}

export async function repoFacts(repoRoot: string): Promise<RepoFacts> {
  return {
    root: repoRoot,
    branch: await currentBranch(repoRoot),
    dirty: await isDirty(repoRoot),
  };
}

/**
 * `git diff main...<branch> --numstat` totals. Returns `undefined` when the
 * diff cannot be computed (unrelated ancestry, missing ref, git failure) —
 * per spec, base/ancestry unavailable → omit totals.
 */
export async function diffTotals(repoRoot: string, branchRef: string): Promise<DiffTotals | undefined> {
  const result = await git(["diff", "main..." + branchRef, "--numstat"], { cwd: repoRoot });
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
export async function listFactoryBranches(repoRoot: string): Promise<BranchFacts[]> {
  const branches: BranchFacts[] = [];

  const localResult = await git(["branch", "--list", "factory/*"], { cwd: repoRoot });
  if (localResult.ok) {
    for (const raw of localResult.stdout.split(/\r?\n/)) {
      // `*` = current branch, `+` = checked out in another worktree.
      const name = raw.replace(/^[*+]?\s*/, "").trim();
      if (name === "") continue;
      branches.push({ name, canonical: canonicalId(name), remote: false });
    }
  }

  const remoteResult = await git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/factory"], {
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

export async function listWorktrees(repoRoot: string): Promise<WorktreeFacts[]> {
  const result = await git(["worktree", "list", "--porcelain"], { cwd: repoRoot });
  if (!result.ok) return [];
  return parseWorktrees(result.stdout);
}
