import { run, type RunResult } from "./git.ts";
import type { CheckState, PullRequest } from "./types.ts";

export interface GitHubRead {
  prs: PullRequest[];
  unavailable: boolean;
  errors: string[];
}

interface GhPr {
  number: number;
  title?: string;
  state?: string;
  headRefName?: string;
  url?: string;
}

export interface GhCheck {
  /** Effective check state (SUCCESS/FAILURE/PENDING/QUEUED/…). */
  state?: string;
  /** gh-computed bucket (pass/fail/pending) — the reliable outcome signal. */
  bucket?: string;
  name?: string;
  workflow?: string;
}

const STATE_TO_RESULT: Readonly<Record<string, CheckState>> = {
  success: "green",
  neutral: "green",
  skipped: "green",
  failure: "red",
  error: "red",
  canceled: "red",
  cancelled: "red",
  timed_out: "red",
  action_required: "red",
  pending: "pending",
  queued: "pending",
  in_progress: "pending",
  waiting: "pending",
  requested: "pending",
};

const BUCKET_TO_RESULT: Readonly<Record<string, CheckState>> = {
  pass: "green",
  fail: "red",
  pending: "pending",
  error: "red",
};

function resultOf(check: GhCheck): CheckState | undefined {
  const bucket = (check.bucket ?? "").toLowerCase();
  if (bucket !== "") {
    const fromBucket = BUCKET_TO_RESULT[bucket];
    if (fromBucket !== undefined) return fromBucket;
  }
  return STATE_TO_RESULT[(check.state ?? "").toLowerCase()];
}

/**
 * Summarize a list of PR checks into a single CheckState.
 * - any red → red; else any unknown → unknown; else any pending → pending;
 * - empty list → none; otherwise all-green → green.
 */
export function summarizeChecks(checks: GhCheck[]): CheckState {
  if (checks.length === 0) return "none";
  let pending = false;
  for (const check of checks) {
    const result = resultOf(check) ?? "unknown";
    if (result === "red") return "red";
    if (result === "unknown") return "unknown";
    if (result === "pending") pending = true;
  }
  return pending ? "pending" : "green";
}

/**
 * Derive a PR check state from a raw `gh pr checks --json` execution result.
 * A gh failure is `unknown`; a "no checks reported" outcome is `none`.
 */
export function checkStateFromResult(result: RunResult): CheckState {
  if (!result.ok) {
    if (/no checks reported/i.test(result.stderr)) return "none";
    return "unknown";
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) return "unknown";
    return summarizeChecks(parsed as GhCheck[]);
  } catch {
    return "unknown";
  }
}

function checkStateFor(prNumber: number): CheckState {
  // Valid `gh pr checks --json` fields: bucket, completedAt, description,
  // event, link, name, startedAt, state, workflow (no `conclusion`).
  const result = run("gh", ["pr", "checks", String(prNumber), "--json", "state,bucket,name,workflow"]);
  return checkStateFromResult(result);
}

export async function readGitHub(opts: { noGh: boolean }): Promise<GitHubRead> {
  const errors: string[] = [];
  if (opts.noGh) {
    return { prs: [], unavailable: true, errors };
  }

  const result = run("gh", ["pr", "list", "--state", "all", "--json", "number,title,state,headRefName,url"]);
  if (!result.ok) {
    errors.push(`gh unavailable: ${result.stderr.trim() || (result.status ?? "missing")}`);
    return { prs: [], unavailable: true, errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    errors.push(`gh pr list returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { prs: [], unavailable: false, errors };
  }
  if (!Array.isArray(raw)) {
    errors.push("gh pr list returned non-array JSON");
    return { prs: [], unavailable: false, errors };
  }

  const prs: PullRequest[] = [];
  for (const item of raw as GhPr[]) {
    prs.push({
      number: item.number,
      title: item.title ?? "",
      state: item.state ?? "unknown",
      headRefName: item.headRefName ?? "",
      url: item.url ?? "",
      checks: checkStateFor(item.number),
    });
  }

  return { prs, unavailable: false, errors };
}
