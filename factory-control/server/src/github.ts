import { run, type RunResult } from "./git.ts";
import { referencedIssueNumbers } from "./markdown.ts";
import type { CheckState, IssueCard, IssueLabels, PullRequest } from "./types.ts";

export interface GitHubRead {
  prs: PullRequest[];
  /** Referenced issue numbers per PR number, extracted from PR bodies (`#N`). */
  prIssueRefs: Record<number, number[]>;
  unavailable: boolean;
  errors: string[];
}

interface GhPr {
  number: number;
  title?: string;
  state?: string;
  headRefName?: string;
  url?: string;
  body?: string;
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

/** Read and summarize one PR's checks. A gh child that hangs past its timeout
 *  degrades to `unknown` and records an `errors` entry — never freeze the
 *  server. Valid `gh pr checks --json` fields: bucket, completedAt,
 *  description, event, link, name, startedAt, state, workflow (no `conclusion`). */
async function readPrChecks(
  prNumber: number,
  errors: string[],
  runner: typeof run = run,
): Promise<CheckState> {
  const result = await runner("gh", ["pr", "checks", String(prNumber), "--json", "state,bucket,name,workflow"]);
  if (!result.ok && result.timedOut) {
    errors.push(`gh pr checks #${prNumber} timed out`);
  }
  return checkStateFromResult(result);
}

export async function readGitHub(
  opts: { noGh: boolean },
  runner: typeof run = run,
): Promise<GitHubRead> {
  const errors: string[] = [];
  if (opts.noGh) {
    return { prs: [], prIssueRefs: {}, unavailable: true, errors };
  }

  const result = await runner("gh", ["pr", "list", "--state", "all", "--json", "number,title,state,headRefName,url,body"]);
  if (!result.ok) {
    errors.push(`gh unavailable: ${result.stderr.trim() || (result.status ?? "missing")}`);
    return { prs: [], prIssueRefs: {}, unavailable: true, errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    errors.push(`gh pr list returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { prs: [], prIssueRefs: {}, unavailable: false, errors };
  }
  if (!Array.isArray(raw)) {
    errors.push("gh pr list returned non-array JSON");
    return { prs: [], prIssueRefs: {}, unavailable: false, errors };
  }

  const prs: PullRequest[] = [];
  const prIssueRefs: Record<number, number[]> = {};
  for (const item of raw as GhPr[]) {
    const refs = referencedIssueNumbers(item.body ?? "");
    if (refs.length > 0) prIssueRefs[item.number] = refs;
    prs.push({
      number: item.number,
      title: item.title ?? "",
      state: item.state ?? "unknown",
      headRefName: item.headRefName ?? "",
      url: item.url ?? "",
      checks: await readPrChecks(item.number, errors, runner),
    });
  }

  return { prs, prIssueRefs, unavailable: false, errors };
}

export interface GitHubIssuesRead {
  issues: IssueCard[];
  unavailable: boolean;
  errors: string[];
}

interface GhIssueLabel {
  name?: string;
}

interface GhIssueAssignee {
  login?: string;
}

interface GhIssue {
  number: number;
  title?: string;
  state?: string;
  labels?: GhIssueLabel[];
  assignees?: GhIssueAssignee[];
  milestone?: { title?: string } | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
  body?: string;
}

function emptyIssueLabels(): IssueLabels {
  return { blocked: false, followUp: false, playtest: false, raw: [] };
}

/** Map raw `gh` label objects to the shared `IssueLabels` shape. */
export function parseIssueLabels(rawLabels: unknown): IssueLabels {
  const names: string[] = [];
  if (Array.isArray(rawLabels)) {
    for (const label of rawLabels) {
      if (label !== null && typeof label === "object" && typeof (label as GhIssueLabel).name === "string") {
        names.push((label as GhIssueLabel).name as string);
      }
    }
  }
  const lowered = new Set(names.map((n) => n.toLowerCase()));
  const typeRaw = names.find((n) => /^type:/i.test(n));
  const roleRaw = names.filter((n) => /^role:/i.test(n));
  const laneRaw = names.find((n) => /^lane:/i.test(n));
  const statusRaw = names.find((n) => /^status:/i.test(n));
  const labels: IssueLabels = {
    role: roleRaw
      .map((n) => n.split(":")[1]?.trim() ?? "")
      .filter((s) => s !== ""),
    blocked: lowered.has("blocked"),
    followUp: lowered.has("follow-up"),
    playtest: lowered.has("playtest"),
    raw: names,
  };
  const typeValue = typeRaw?.split(":")[1]?.trim();
  if (typeValue) labels.type = typeValue;
  const laneValue = laneRaw?.split(":")[1]?.trim();
  if (laneValue) labels.lane = laneValue;
  const statusValue = statusRaw?.split(":")[1]?.trim();
  if (statusValue) labels.status = statusValue;
  return labels;
}

function parseAssignees(assignees: unknown): string[] {
  if (!Array.isArray(assignees)) return [];
  const logins: string[] = [];
  for (const assignee of assignees) {
    if (assignee !== null && typeof assignee === "object" && typeof (assignee as GhIssueAssignee).login === "string") {
      logins.push((assignee as GhIssueAssignee).login as string);
    }
  }
  return logins;
}

/** First ~200 chars of the body, trimmed and whitespace-collapsed. */
export function issueBodyExcerpt(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 200);
}

/**
 * Parse one `gh issue list` record into an `IssueCard`. Never throws: a
 * malformed record is retained with `state: "unknown"` and the error is
 * returned alongside so the caller can record an `errors` entry.
 */
export function parseIssueCard(item: unknown): { card: IssueCard; error?: string } {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return {
      card: {
        number: 0,
        title: "",
        state: "unknown",
        url: "",
        labels: emptyIssueLabels(),
        assignees: [],
      },
      error: "gh issue list record parse failed: record is not an object",
    };
  }
  const rec = item as GhIssue;
  const numberOk = typeof rec.number === "number" && Number.isInteger(rec.number) && rec.number > 0;
  const titleOk = typeof rec.title === "string" && rec.title.trim() !== "";
  const stateRaw = typeof rec.state === "string" ? rec.state.toLowerCase() : "";
  const state: "open" | "closed" | "unknown" =
    stateRaw === "open" ? "open" : stateRaw === "closed" ? "closed" : "unknown";

  const card: IssueCard = {
    number: numberOk ? rec.number : 0,
    title: titleOk ? (rec.title as string) : "",
    state,
    url: typeof rec.url === "string" ? rec.url : "",
    labels: parseIssueLabels(rec.labels),
    assignees: parseAssignees(rec.assignees),
  };
  if (rec.milestone !== null && rec.milestone !== undefined && typeof rec.milestone === "object") {
    const milestone = rec.milestone as { title?: unknown };
    if (typeof milestone.title === "string") card.milestone = milestone.title;
  }
  if (typeof rec.createdAt === "string") card.createdAt = rec.createdAt;
  if (typeof rec.updatedAt === "string") card.updatedAt = rec.updatedAt;
  if (typeof rec.body === "string") card.bodyExcerpt = issueBodyExcerpt(rec.body);

  if (!numberOk || !titleOk) {
    const reason = [!numberOk ? "number missing/non-numeric" : "", !titleOk ? "title missing" : ""]
      .filter((s) => s !== "")
      .join("; ");
    return { card: { ...card, state: "unknown" }, error: `gh issue list record #${card.number} parse failed: ${reason}` };
  }
  return { card };
}

/**
 * Read repository issues via `gh issue list`. Defensive: `noGh` or a gh
 * failure degrades to `unavailable` + errors; invalid JSON records an error
 * (not unavailable); malformed rows are retained with `state: "unknown"` and
 * an error entry. Never throws.
 */
export async function readGitHubIssues(
  opts: { noGh: boolean },
  runner: typeof run = run,
): Promise<GitHubIssuesRead> {
  const errors: string[] = [];
  if (opts.noGh) {
    return { issues: [], unavailable: true, errors };
  }

  const result = await runner("gh", [
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "500",
    "--json",
    "number,title,state,labels,assignees,milestone,createdAt,updatedAt,url,body",
  ]);
  if (!result.ok) {
    errors.push(`gh unavailable: ${result.stderr.trim() || (result.status ?? "missing")}`);
    return { issues: [], unavailable: true, errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    errors.push(`gh issue list returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { issues: [], unavailable: false, errors };
  }
  if (!Array.isArray(raw)) {
    errors.push("gh issue list returned non-array JSON");
    return { issues: [], unavailable: false, errors };
  }

  const issues: IssueCard[] = [];
  for (const item of raw) {
    const parsed = parseIssueCard(item);
    issues.push(parsed.card);
    if (parsed.error !== undefined) errors.push(parsed.error);
  }

  return { issues, unavailable: false, errors };
}
