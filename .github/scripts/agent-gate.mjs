// Agent pipeline glue (SPEC/github-agent-pipeline.md, D057).
//
// Loaded by agent-dispatch.yml and agent-gate.yml through actions/github-script
// from a checkout of the default branch, never from pull request code. The pure
// helpers and handlers are unit-tested in agent-gate.test.mjs; handlers receive
// the github-script `github`, `context`, and `core` objects plus `process.env`.
// All issue, PR, comment, review, and spec text is untrusted and handled only as data.
//
// Trust model: verdicts count only when posted by github-actions[bot] and bound
// to the head SHA and the latest run of the factory workflow for it; gate
// markers count only when posted by the PAT user. Any workflow in this repo with
// a write-capable GITHUB_TOKEN could still post as github-actions[bot], so the
// sensitive-path rule (workflows never auto-merge) is the backstop.

export const LABEL = Object.freeze({
    go: "agent:go",
    active: "agent:active",
    needsHuman: "agent:needs-human",
    cycle1: "cycle:1",
    cycle2: "cycle:2",
    spec: "status:spec",
    ready: "status:ready",
    review: "status:review",
});

export const STATUS_LABELS = Object.freeze(["status:spec", "status:ready", "status:in-progress", "status:review"]);
export const CYCLE_LABELS = Object.freeze([LABEL.cycle1, LABEL.cycle2]);

/** Build profiles a spec's Delegation section may name, mapped to their role label. */
export const BUILD_PROFILES = Object.freeze({
    builder: "role:builder",
    artist: "role:art",
    "gameplay-designer": "role:design",
    "docs-writer": "role:docs",
});

export const QA_DEPTHS = Object.freeze(["fast", "slow"]);
export const DEFAULT_QA_DEPTH = "fast";
export const DEFAULT_MAX_ACTIVE = 3;
export const MAX_FOLLOW_UPS = 5;

export const LOW_RISK_LABELS = Object.freeze(["type:docs", "type:chore", "follow-up"]);
export const HUMAN_MERGE_LABELS = Object.freeze(["type:feature", "type:bug", "playtest"]);

export const SENSITIVE_PREFIXES = Object.freeze([".github/", "deploy/", "scripts/", "factory-control/server/"]);
export const SENSITIVE_BASENAMES = Object.freeze(["dockerfile", "package.json", "package-lock.json", ".npmrc", ".dockerignore"]);

export const COPILOT_ASSIGNEE = "copilot-swe-agent[bot]";
export const FACTORY_BOT_LOGIN = "github-actions[bot]";
export const REVIEW_WORKFLOW_FILE = "factory-review.lock.yml";
export const QA_WORKFLOW_FILE = "factory-qa.lock.yml";
export const QA_PASS_MARKER = "<!-- factory-qa:pass -->";
export const QA_FAIL_MARKER = "<!-- factory-qa:fail -->";

const COPILOT_AUTHORS = new Set(["copilot", "copilot-swe-agent", "copilot-swe-agent[bot]", "app/copilot-swe-agent"]);
const COPILOT_COMMENTERS = new Set(["copilot", "copilot-swe-agent[bot]"]);
const COPILOT_REVIEWERS = new Set(["copilot-pull-request-reviewer", "copilot-pull-request-reviewer[bot]"]);
const ROLE_RANK = Object.freeze({ none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 });
const MAX_QUOTE_LENGTH = 3000;
const SPEC_FILE = /^SPEC\/[^/]+\.md$/;
const GENERATED_BLOCK = /<!-- auto-generated-pr-description:start -->[\s\S]*?(?:<!-- auto-generated-pr-description:end -->|$)/g;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True for the Copilot cloud agent's logins (REST and GraphQL forms). */
export function isCopilotAuthor(login) {
    return typeof login === "string" && COPILOT_AUTHORS.has(login.toLowerCase());
}

export function isCopilotReviewer(login) {
    return typeof login === "string" && COPILOT_REVIEWERS.has(login.toLowerCase());
}

/** A pipeline PR is opened by the Copilot bot from a branch in this repository. */
export function isPipelinePr(pr, repoFullName) {
    return isCopilotAuthor(pr?.user?.login) && pr?.user?.type === "Bot" && pr?.head?.repo?.full_name === repoFullName;
}

/** Human gates (`agent:go`, `/approve-spec`) accept only human accounts. */
export function isHumanActor(user) {
    return user?.type === "User" && !isCopilotAuthor(user?.login);
}

/** Compare a repository role name (`role_name` from the permission API) against a minimum. */
export function hasRole(roleName, minimum) {
    const required = ROLE_RANK[minimum];
    if (required === undefined) {
        throw new Error(`unknown role "${minimum}"`);
    }
    const actual = ROLE_RANK[String(roleName ?? "none").toLowerCase()] ?? 0;
    return actual >= required;
}

export function labelNames(labels) {
    return new Set([...(labels ?? [])].map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean));
}

export function isWipTitle(title) {
    return /^\s*\[WIP\]/i.test(title ?? "");
}

/** Title without any leading `[WIP]` prefixes. */
export function stripWipTitle(title) {
    return String(title ?? "").replace(/^(?:\s*\[WIP\]\s*)+/i, "");
}

/** A comment posted by the Copilot cloud agent itself (it replies when a session ends). */
export function isCopilotBotUser(user) {
    return COPILOT_COMMENTERS.has(String(user?.login ?? "").toLowerCase()) && user?.type === "Bot";
}

export function stripHtmlComments(text) {
    return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** Remove the pr-description workflow's generated block (it is not written by the agent). */
export function stripGenerated(text) {
    return String(text ?? "").replace(GENERATED_BLOCK, "");
}

/** Insert a zero-width space after `@` so quoted text cannot mention anyone. */
export function neutralizeMentions(text) {
    return String(text ?? "").replace(/@(?=[A-Za-z0-9_-])/g, "@\u200b");
}

/** Issue numbers referenced with a GitHub closing keyword (`Closes #12`, `Fixes #12`, ...), in order. */
export function parseLinkedIssues(body) {
    const numbers = [];
    const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)\b/gi;
    for (const match of stripHtmlComments(stripGenerated(body)).matchAll(pattern)) {
        const number = Number(match[1]);
        if (!numbers.includes(number)) {
            numbers.push(number);
        }
    }
    return numbers;
}

function normalizeHeading(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FENCE = /^\s*(?:```|~~~)/;

/**
 * Text of a `## <heading>` section (any of `headings`, compared ignoring case,
 * spaces, and punctuation) up to the next heading of any level outside a code
 * fence, or null when absent.
 */
export function extractSection(markdown, headings) {
    const wanted = new Set([headings].flat().map(normalizeHeading));
    const collected = [];
    let inFence = false;
    let found = false;
    for (const line of String(markdown ?? "").split(/\r?\n/)) {
        const fence = FENCE.test(line);
        if (!found) {
            if (fence) {
                inFence = !inFence;
            } else if (!inFence) {
                const heading = /^##\s+(.*)$/.exec(line);
                found = Boolean(heading && wanted.has(normalizeHeading(heading[1])));
            }
            continue;
        }
        if (fence) {
            inFence = !inFence;
        } else if (!inFence && /^#{1,6}\s/.test(line)) {
            break;
        }
        collected.push(line);
    }
    return found ? collected.join("\n") : null;
}

/** Lines of a section outside code fences. */
function unfencedLines(section) {
    const lines = [];
    let inFence = false;
    for (const line of String(section).split(/\r?\n/)) {
        if (FENCE.test(line)) {
            inFence = !inFence;
        } else if (!inFence) {
            lines.push(line);
        }
    }
    return lines;
}

const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Parse a spec's `## Delegation` section: ordered `- <profile>: <task>` steps
 * plus one `QA depth: fast|slow` line. Returns errors instead of guessing; a
 * missing QA depth falls back to fast with a warning.
 */
export function parseDelegation(markdown) {
    const section = extractSection(markdown, "Delegation");
    if (section === null) {
        return { steps: [], qaDepth: null, errors: ["The spec has no `## Delegation` section."], warnings: [] };
    }
    const steps = [];
    const errors = [];
    const warnings = [];
    let qaDepth = null;
    for (const rawLine of unfencedLines(stripHtmlComments(section))) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const plain = line.replace(LIST_ITEM, "$1").replace(/[`*]/g, "").trim();
        const qa = /^qa[\s_-]*depth\b\s*[:=]?\s*(.*)$/i.exec(plain);
        if (qa) {
            const value = qa[1].trim().toLowerCase().replace(/[.\s].*$/, "");
            if (!QA_DEPTHS.includes(value)) {
                errors.push(`QA depth must be \`fast\` or \`slow\`, not "${qa[1].trim()}".`);
            } else if (qaDepth !== null) {
                errors.push("QA depth is given more than once.");
            } else {
                qaDepth = value;
            }
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (!item || /^\s/.test(rawLine)) {
            continue;
        }
        const step = /^([^:]+):\s*(\S.*)$/.exec(item[1]);
        if (!step) {
            errors.push(`Delegation step "${item[1]}" is not in the form \`- <profile>: <task>\`.`);
            continue;
        }
        const profile = step[1].replace(/[`*]/g, "").trim().toLowerCase();
        if (!Object.hasOwn(BUILD_PROFILES, profile)) {
            errors.push(`Unknown delegation profile "${step[1].trim()}"; use one of ${Object.keys(BUILD_PROFILES).join(", ")}.`);
            continue;
        }
        steps.push({ profile, task: step[2].trim() });
    }
    if (steps.length === 0 && errors.length === 0) {
        errors.push("The `## Delegation` section lists no `- <profile>: <task>` steps.");
    }
    if (qaDepth === null) {
        warnings.push(`No QA depth given; using \`${DEFAULT_QA_DEPTH}\`.`);
    }
    return { steps, qaDepth: qaDepth ?? DEFAULT_QA_DEPTH, errors, warnings };
}

/** Role labels mirroring the delegation steps, in first-use order. */
export function roleLabelsFor(steps) {
    return [...new Set(steps.map(({ profile }) => BUILD_PROFILES[profile]))];
}

/** Items under `## Follow-ups` (top-level list items, skipping None/N/A variants), capped at `max`. */
export function parseFollowUps(body, max = MAX_FOLLOW_UPS) {
    const section = extractSection(stripHtmlComments(stripGenerated(body)), "Follow-ups");
    if (section === null) {
        return { items: [], skipped: 0 };
    }
    const items = [];
    for (const line of unfencedLines(section)) {
        const item = LIST_ITEM.exec(line);
        if (!item) {
            continue;
        }
        const text = item[1].replace(/^\[[ xX]\]\s*/, "").trim();
        const plain = text.replace(/[_*`~]/g, "").trim();
        if (!plain || /^(?:none|n\/?a|nothing)\b/i.test(plain)) {
            continue;
        }
        items.push(text);
    }
    return { items: items.slice(0, max), skipped: Math.max(0, items.length - max) };
}

/** Next D050 review/fix cycle label, or `exhausted` once `cycle:2` is used. */
export function nextCycle(labels) {
    const names = labelNames(labels);
    if (names.has(LABEL.cycle2)) {
        return { exhausted: true, label: null };
    }
    return { exhausted: false, label: names.has(LABEL.cycle1) ? LABEL.cycle2 : LABEL.cycle1 };
}

export function isSensitivePath(filename) {
    const path = String(filename ?? "")
        .replace(/^(?:\.\/|\/)+/, "")
        .toLowerCase();
    const basename = path.split("/").pop();
    return SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix)) || SENSITIVE_BASENAMES.includes(basename) || basename.startsWith("dockerfile.");
}

/** Sensitive paths touched by a list of PR or commit files (`{ filename, previous_filename }` or strings). */
export function sensitivePaths(files) {
    const hits = new Set();
    for (const file of files ?? []) {
        for (const name of typeof file === "string" ? [file] : [file?.filename, file?.previous_filename]) {
            if (name && isSensitivePath(name)) {
                hits.add(name);
            }
        }
    }
    return [...hits];
}

/**
 * D057 merge rule once every gate is green: sensitive paths always need a
 * human; otherwise auto-merge only low-risk types, and the strictest label wins.
 */
export function mergeDecision({ labels, files }) {
    const names = labelNames(labels);
    const sensitive = sensitivePaths(files);
    if (sensitive.length > 0) {
        return { action: "needs-human", reason: "sensitive-paths", sensitive };
    }
    const lowRisk = LOW_RISK_LABELS.some((label) => names.has(label));
    const humanMerge = HUMAN_MERGE_LABELS.filter((label) => names.has(label));
    if (lowRisk && humanMerge.length === 0) {
        return { action: "auto-merge", reason: "low-risk", sensitive };
    }
    return { action: "needs-human", reason: humanMerge.length > 0 ? "human-merge-type" : "no-low-risk-type", sensitive };
}

/** Suggested spec path `SPEC/<unit-id-or-issue-N>-<slug>.md` for an issue. */
export function specPathFor(issue) {
    const title = String(issue?.title ?? "");
    const formUnit = /###\s*Unit ID\s*\n+\s*(T\d+[A-Za-z0-9]*)\b/i.exec(String(issue?.body ?? ""));
    const titleUnit = /^\s*(T\d+[A-Za-z0-9]*)\s*[:-]/i.exec(title);
    const unit = (formUnit?.[1] ?? titleUnit?.[1])?.toUpperCase() ?? `issue-${issue?.number}`;
    const slug =
        title
            .replace(/^\s*T\d+[A-Za-z0-9]*\s*[:-]\s*/i, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48)
            .replace(/-+$/, "") || "unit";
    return `SPEC/${unit}-${slug}.md`;
}

/**
 * Parse `/approve-spec [sha]`. Returns `{ ok: true }` or `{ ok: false, reason }`.
 * A SHA argument must be 7-40 hex characters and prefix the PR head.
 */
export function parseApproveCommand(body, headSha) {
    const firstLine = String(body ?? "").trim().split(/\r?\n/)[0];
    const match = /^\/approve-spec(?:\s+(\S+))?/.exec(firstLine);
    if (!match) {
        return { ok: false, reason: "not an /approve-spec command" };
    }
    const sha = match[1];
    if (sha === undefined) {
        return { ok: true };
    }
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
        return { ok: false, reason: `\`${sha.slice(0, 40)}\` is not a commit SHA (7-40 hex characters).` };
    }
    if (!String(headSha ?? "").startsWith(sha.toLowerCase())) {
        return { ok: false, reason: `\`${sha}\` does not match the PR head \`${String(headSha).slice(0, 7)}\`; review the latest commit and approve again.` };
    }
    return { ok: true };
}

function runPathMatches(run, file) {
    const path = String(run?.path ?? "");
    const expected = `.github/workflows/${file}`;
    return path === expected || path.startsWith(`${expected}@`);
}

/**
 * Milliseconds since the epoch for an ISO timestamp, or NaN. Fractions beyond
 * milliseconds (the tasks API sends nanoseconds) are truncated first.
 */
export function timeMs(value) {
    if (typeof value !== "string" || value === "") {
        return Number.NaN;
    }
    return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

/** Latest `pull_request` run of the given workflow file; `done` once completed and not skipped. */
export function latestRunState(runs, file) {
    const latest = (runs ?? [])
        .filter((run) => run.event === "pull_request" && (!file || runPathMatches(run, file)))
        .sort((a, b) => (timeMs(a.created_at) || 0) - (timeMs(b.created_at) || 0) || a.id - b.id)
        .at(-1);
    if (!latest) {
        return { done: false, run: null };
    }
    return { done: latest.status === "completed" && latest.conclusion !== "skipped", run: latest };
}

/**
 * Latest factory-reviewer review for the head SHA, posted by github-actions[bot]
 * no earlier than `notBefore` (the start of the latest successful review run).
 */
export function pickFactoryReview(reviews, sha, notBefore) {
    const matching = (reviews ?? []).filter(
        (review) =>
            review?.user?.login === FACTORY_BOT_LOGIN &&
            review.commit_id === sha &&
            review.state !== "PENDING" &&
            review.state !== "DISMISSED" &&
            (!notBefore || String(review.submitted_at ?? "") >= String(notBefore)),
    );
    return matching.at(-1) ?? null;
}

export function hasCopilotReview(reviews) {
    return (reviews ?? []).some((review) => isCopilotReviewer(review?.user?.login) && review.state !== "PENDING");
}

/**
 * Latest factory-qa verdict comment for the head SHA and QA run: posted by
 * github-actions[bot], with `Head: <sha>` and `Run: <runId>` lines and exactly one marker.
 */
export function findQaVerdict(comments, sha, runId) {
    if (!sha || !runId) {
        return null;
    }
    let verdict = null;
    for (const comment of comments ?? []) {
        const body = String(comment?.body ?? "");
        if (comment?.user?.login !== FACTORY_BOT_LOGIN || !body.split(/\r?\n/).includes(`Head: ${sha}`) || !body.split(/\r?\n/).includes(`Run: ${runId}`)) {
            continue;
        }
        const pass = body.includes(QA_PASS_MARKER);
        const fail = body.includes(QA_FAIL_MARKER);
        if (pass !== fail) {
            verdict = { verdict: pass ? "pass" : "fail", comment };
        }
    }
    return verdict;
}

/** Lines tagged `[blocker]` in a review body. */
export function reviewBlockers(body) {
    return stripHtmlComments(body)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\[blocker\]/i.test(line));
}

/**
 * Aggregate required checks from check runs and commit statuses.
 * Success, neutral, and skipped pass; missing or running checks are pending.
 */
export function requiredChecksState(requiredContexts, checkRuns, statuses) {
    const failing = [];
    const pending = [];
    for (const name of requiredContexts ?? []) {
        const run = (checkRuns ?? [])
            .filter((candidate) => candidate.name === name)
            .sort((a, b) => String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")) || (a.id ?? 0) - (b.id ?? 0))
            .at(-1);
        if (run) {
            if (run.status !== "completed") {
                pending.push(name);
            } else if (!["success", "neutral", "skipped"].includes(run.conclusion)) {
                failing.push(name);
            }
            continue;
        }
        const status = (statuses ?? []).find((entry) => entry.context === name);
        if (!status || status.state === "pending") {
            pending.push(name);
        } else if (status.state !== "success") {
            failing.push(name);
        }
    }
    const state = failing.length > 0 ? "failure" : pending.length > 0 ? "pending" : "success";
    return { state, failing, pending };
}

export function quote(text, limit = MAX_QUOTE_LENGTH) {
    const clean = neutralizeMentions(stripHtmlComments(text).trim());
    const clipped = clean.length > limit ? `${clean.slice(0, limit)}\n…(truncated)` : clean;
    return clipped
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
}

export function gateMarker(kind, value) {
    return kind === "bound" ? `<!-- agent-gate:bound pr=${value} -->` : `<!-- agent-gate:${kind} sha=${value} -->`;
}

/** True when `comments` contain `marker` in a comment authored by the PAT user. */
export function hasTrustedMarker(comments, marker, patLogin) {
    return Boolean(patLogin) && (comments ?? []).some((comment) => comment?.user?.login === patLogin && String(comment.body ?? "").includes(marker));
}

export function followUpTitle(prNumber, text) {
    const clean = neutralizeMentions(text.replace(/\s+/g, " "));
    return `Follow-up from #${prNumber}: ${clean.length > 80 ? `${clean.slice(0, 77)}...` : clean}`;
}

/**
 * PR body with `Closes #<issue>` under `## Linked issue`, or null when that
 * section already closes the issue. An empty `Closes #` template placeholder is
 * replaced; otherwise the line goes right after the heading (a missing section
 * is added at the top). The rest of the body is preserved.
 */
export function fillLinkedIssue(body, issueNumber) {
    const text = String(body ?? "");
    const section = extractSection(stripGenerated(text), "Linked issue");
    if (section !== null && parseLinkedIssues(section).includes(issueNumber)) {
        return null;
    }
    const closes = `Closes #${issueNumber}`;
    const lines = text.split(/\r?\n/);
    let inFence = false;
    let inGenerated = false;
    let heading = -1;
    for (const [index, line] of lines.entries()) {
        if (line.includes("<!-- auto-generated-pr-description:start -->")) {
            inGenerated = true;
        }
        if (line.includes("<!-- auto-generated-pr-description:end -->")) {
            inGenerated = false;
            continue;
        }
        if (FENCE.test(line)) {
            inFence = !inFence;
        } else if (!inFence && !inGenerated && /^##\s+/.test(line) && normalizeHeading(line.replace(/^##\s+/, "")) === "linkedissue") {
            heading = index;
            break;
        }
    }
    if (heading === -1) {
        return `## Linked issue\n\n${closes}\n\n${text}`;
    }
    for (let index = heading + 1; index < lines.length && !/^#{1,6}\s/.test(lines[index]); index++) {
        if (/^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*#\s*$/i.test(lines[index])) {
            lines[index] = closes;
            return lines.join("\n");
        }
    }
    lines.splice(heading + 1, 0, "", closes);
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Copilot session state (agent tasks API)
// ---------------------------------------------------------------------------

const ACTIVE_SESSION_STATES = new Set(["in_progress", "queued"]);
const ENDED_SESSION_STATES = new Set(["completed", "failed", "cancelled", "canceled", "timed_out"]);
const HANDOFF_MARKER = /<!-- agent-gate:(?:build|fix) sha=/;

/** `created_at` of the latest PAT-authored build or fix hand-off comment, or null. */
export function latestHandoffAt(comments, patLogin) {
    const times = (comments ?? [])
        .filter((comment) => Boolean(patLogin) && comment?.user?.login === patLogin && HANDOFF_MARKER.test(String(comment.body ?? "")))
        .map((comment) => comment.created_at)
        .filter((time) => !Number.isNaN(timeMs(time)))
        .sort((a, b) => timeMs(a) - timeMs(b));
    return times.at(-1) ?? null;
}

/** A Copilot agent task belongs to a PR when it has the PR (by database id) or its head branch as an artifact. */
export function taskMatchesPr(task, pr) {
    return (task?.artifacts ?? []).some(
        (artifact) =>
            (artifact?.type === "pull" && pr?.id !== undefined && artifact.data?.id === pr.id) ||
            (artifact?.type === "branch" && Boolean(pr?.head?.ref) && artifact.data?.head_ref === pr.head.ref),
    );
}

/**
 * Copilot activity across the PR's tasks (each with `sessions`): `working` when
 * any session (or a task without sessions) is in progress or queued; `unknown`
 * for a task without sessions or a session in an unrecognised state; `done`
 * when every session has ended and, with `since`, at least one session was
 * created after it (the current hand-off); otherwise `pending`.
 */
export function copilotActivity(tasks, { since = null } = {}) {
    if (!tasks || tasks.length === 0) {
        return { state: "unknown", reason: "no Copilot task is linked to this pull request" };
    }
    let unknown = null;
    let afterHandoff = false;
    for (const task of tasks) {
        const sessions = task?.sessions ?? [];
        if (sessions.length === 0) {
            if (ACTIVE_SESSION_STATES.has(String(task?.state).toLowerCase())) {
                return { state: "working", reason: `task ${task.id} is ${task.state}` };
            }
            unknown ??= `task ${task.id} reports no sessions`;
            continue;
        }
        for (const session of sessions) {
            const state = String(session?.state).toLowerCase();
            if (ACTIVE_SESSION_STATES.has(state)) {
                return { state: "working", reason: `task ${task.id} has a session ${state}` };
            }
            if (!ENDED_SESSION_STATES.has(state)) {
                unknown ??= `task ${task.id} has a session in state "${session?.state}"`;
            } else if (since && timeMs(session?.created_at) > timeMs(since)) {
                // NaN never compares greater, so an unreadable time leaves the hand-off pending.
                afterHandoff = true;
            }
        }
    }
    if (unknown) {
        return { state: "unknown", reason: unknown };
    }
    if (since && !afterHandoff) {
        return { state: "pending", reason: `no Copilot session has started since the hand-off at ${since}` };
    }
    return { state: "done", reason: "every Copilot session has ended" };
}

// ---------------------------------------------------------------------------
// Instruction text
// ---------------------------------------------------------------------------

const FINAL_SUMMARY_RULE =
    "- As your final step, post a pull request comment summarising what you changed, the validation you ran with its results, and any deferred follow-ups. The pipeline links the issue and detects when your session ends.";

export function specInstructions({ issueNumber, specPath }) {
    return [
        `Spec only: do not implement anything. Act as the factory-orchestrator (cloud mode) for issue #${issueNumber}.`,
        "1. Read AGENTS.md, docs/FACTORY.md, docs/DECISIONS.md, docs/GAME-CONTRACT.md, and the issue.",
        `2. Write ${specPath}: goal, acceptance criteria, validation commands, and out-of-scope items. Keep it short.`,
        "3. Include a `## Delegation` section listing the ordered build steps, one per line, as `- <profile>: <task>`. Use only these profiles: builder, artist, gameplay-designer, docs-writer. Add one line `- QA depth: fast` or `- QA depth: slow`.",
        "4. Commit only the spec to the draft pull request for this issue.",
        "5. Work in this session yourself. Do not use the task/subagent tool or start custom agents (their pinned models fail in the cloud).",
        "6. As your final step, post a pull request comment summarising the spec and any open questions. The pipeline links the issue and detects when your session ends.",
        "7. Stop. Do not write code. A human approves the spec by commenting /approve-spec on the pull request.",
    ].join("\n");
}

const NO_SUBAGENTS_RULE =
    "- Work in this session yourself. Do NOT use the task/subagent tool or start custom agents; their pinned models fail in the cloud.";

export function buildInstructions({ specPath, steps, qaDepth, sha }) {
    const stepLines = steps.map(
        ({ profile, task }, index) =>
            `${index + 1}. **${profile}**: ${task}\n   Act as this profile yourself: read \`.github/agents/${profile}.agent.md\` and \`.github/skills/${profile}/SKILL.md\` and follow them for this step.`,
    );
    return [
        `@copilot The spec is approved. Implement \`${specPath}\` on this pull request by following its \`## Delegation\` section in order:`,
        "",
        ...stepLines,
        "",
        `QA depth: ${qaDepth}.`,
        "",
        "Rules:",
        "- Read AGENTS.md first and stay within the spec's scope.",
        NO_SUBAGENTS_RULE,
        "- Run `npm run check` after each step; it must pass before you finish.",
        "- Leave the pull request as a draft; when your session ends the pipeline marks it ready for review.",
        FINAL_SUMMARY_RULE,
        "",
        gateMarker("build", sha),
    ].join("\n");
}

export function fixInstructions({ blockers, cycleLabel, steps, sha }) {
    const owners = steps.length > 0 ? [...new Set(steps.map(({ profile }) => `\`${profile}\``))].join(", ") : "the profile that owns the affected files";
    return [
        `@copilot Review/QA found blockers on ${sha.slice(0, 7)} (${cycleLabel}, D050). Fix only these yourself in this session, acting as the role from the spec's Delegation section that owns the affected files (${owners}): read its \`.github/agents/<profile>.agent.md\` and \`.github/skills/<profile>/SKILL.md\` and follow them. Do NOT use the task/subagent tool or start custom agents; their pinned models fail in the cloud. Run \`npm run check\` before you finish.`,
        "",
        ...blockers.flatMap(({ source, details }) => [`**${source}**`, "", details, ""]),
        "The pull request is back in draft. When your session ends, the pipeline requests one fresh review and QA. If a blocker is already resolved in the head commit (a possible false positive), do not push a no-op change; say so in your final comment and quote the line that resolves it.",
        "",
        FINAL_SUMMARY_RULE,
        "",
        gateMarker("fix", sha),
    ].join("\n");
}

// ---------------------------------------------------------------------------
// GitHub clients and shared operations
// ---------------------------------------------------------------------------

/** Minimal REST/GraphQL client for the user PAT (COPILOT_ASSIGN_TOKEN). */
export function createPatClient(token, fetchImpl = globalThis.fetch) {
    if (!token) {
        throw new Error("The COPILOT_ASSIGN_TOKEN secret is not configured.");
    }
    let cachedLogin = null;
    async function request(method, path, body) {
        const response = await fetchImpl(`https://api.github.com${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "pacman-256-agent-pipeline",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }
        if (!response.ok) {
            throw new Error(`${method} ${path} failed (${response.status}): ${data?.message ?? text.slice(0, 200)}`);
        }
        return data;
    }
    async function graphql(query, variables) {
        const data = await request("POST", "/graphql", { query, variables });
        if (data?.errors?.length) {
            throw new Error(`GraphQL error: ${data.errors.map((error) => error.message).join("; ")}`);
        }
        return data?.data;
    }
    async function login() {
        cachedLogin ??= (await request("GET", "/user"))?.login ?? null;
        if (!cachedLogin) {
            throw new Error("Could not resolve the COPILOT_ASSIGN_TOKEN user.");
        }
        return cachedLogin;
    }
    return { request, graphql, login };
}

const MUTATIONS = Object.freeze({
    markReady: "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number } } }",
    toDraft: "mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { number } } }",
    enableAutoMerge:
        "mutation($id: ID!, $sha: GitObjectID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH, expectedHeadOid: $sha }) { pullRequest { number } } }",
    disableAutoMerge: "mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { number } } }",
});

function ops({ github, context }) {
    const { owner, repo } = context.repo;
    return {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        async role(username) {
            try {
                const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
                return data.role_name ?? data.permission ?? "none";
            } catch (error) {
                if (error.status === 404) {
                    return "none";
                }
                throw error;
            }
        },
        async issue(issue_number) {
            return (await github.rest.issues.get({ owner, repo, issue_number })).data;
        },
        async addLabels(issue_number, labels) {
            if (labels.length > 0) {
                await github.rest.issues.addLabels({ owner, repo, issue_number, labels });
            }
        },
        async removeLabels(issue_number, labels, current) {
            for (const name of new Set(labels)) {
                if (current && !current.has(name)) {
                    continue;
                }
                try {
                    await github.rest.issues.removeLabel({ owner, repo, issue_number, name });
                } catch (error) {
                    if (error.status !== 404) {
                        throw error;
                    }
                }
            }
        },
        async comment(issue_number, body) {
            await github.rest.issues.createComment({ owner, repo, issue_number, body });
        },
        async comments(issue_number) {
            return github.paginate(github.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
        },
        async files(pull_number) {
            return github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number, per_page: 100 });
        },
        /** Net diff files plus the files of every commit in the PR. */
        async allFiles(pull_number) {
            const files = [...(await this.files(pull_number))];
            const commits = await github.paginate(github.rest.pulls.listCommits, { owner, repo, pull_number, per_page: 100 });
            for (const commit of commits) {
                const { data } = await github.rest.repos.getCommit({ owner, repo, ref: commit.sha });
                files.push(...(data.files ?? []));
            }
            return files;
        },
        async fileAt(path, ref) {
            const { data } = await github.rest.repos.getContent({ owner, repo, path, ref });
            return Buffer.from(data.content ?? "", data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
        },
        async setTitle(pull_number, title) {
            await github.rest.pulls.update({ owner, repo, pull_number, title });
        },
        async setBody(pull_number, body) {
            await github.rest.pulls.update({ owner, repo, pull_number, body });
        },
    };
}

/**
 * Whether Copilot is still working on a PR, from the agent tasks API (PAT).
 * Any failure is `unknown`, logged, and never thrown.
 */
async function copilotSessionStatus({ core, env }, api, pr, since = null) {
    try {
        const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
        const list = await pat.request("GET", `/agents/repos/${api.owner}/${api.repo}/tasks`);
        const matches = (list?.tasks ?? []).filter((task) => taskMatchesPr(task, pr));
        const tasks = [];
        for (const task of matches) {
            tasks.push(await pat.request("GET", `/agents/repos/${api.owner}/${api.repo}/tasks/${encodeURIComponent(task.id)}`));
        }
        const status = copilotActivity(tasks, { since });
        core.info(`Copilot activity on PR #${pr.number}: ${status.state} (${status.reason}).`);
        return status;
    } catch (error) {
        core.warning(`Could not read Copilot task state for PR #${pr.number}: ${error.message}`);
        return { state: "unknown", reason: error.message };
    }
}

/**
 * Resolve a pipeline PR (Copilot bot, same-repo branch) with exactly one linked
 * issue carrying `agent:active`. More than one such issue stops the pipeline.
 */
async function resolvePipelinePr({ github, context, core }, pullNumber) {
    const api = ops({ github, context });
    const { data: pr } = await github.rest.pulls.get({ owner: api.owner, repo: api.repo, pull_number: pullNumber });
    if (!isPipelinePr(pr, api.fullName)) {
        core.info(`PR #${pullNumber} is not a Copilot PR from this repository; ignoring.`);
        return null;
    }
    const active = [];
    for (const number of parseLinkedIssues(pr.body)) {
        const issue = await api.issue(number);
        const labels = labelNames(issue.labels);
        if (!issue.pull_request && labels.has(LABEL.active)) {
            active.push({ issue, labels });
        }
    }
    if (active.length === 0) {
        core.info(`PR #${pullNumber} has no linked issue with ${LABEL.active}; ignoring.`);
        return null;
    }
    if (active.length > 1) {
        const unflagged = active.filter(({ labels }) => !labels.has(LABEL.needsHuman));
        if (unflagged.length > 0) {
            for (const { issue } of unflagged) {
                await api.addLabels(issue.number, [LABEL.needsHuman]);
            }
            const list = active.map(({ issue }) => `#${issue.number}`).join(", ");
            await api.comment(pr.number, `**Agent pipeline stopped** (\`${LABEL.needsHuman}\`): this PR links ${active.length} issues with \`${LABEL.active}\` (${list}); a pipeline PR must close exactly one.`);
        }
        core.info(`PR #${pullNumber} links more than one ${LABEL.active} issue; stopped.`);
        return null;
    }
    return { api, pr, issue: active[0].issue, labels: active[0].labels };
}

async function stopForHuman(api, { issueNumber, commentOn, message }) {
    await api.addLabels(issueNumber, [LABEL.needsHuman]);
    await api.comment(commentOn ?? issueNumber, `**Agent pipeline stopped** (\`${LABEL.needsHuman}\`): ${message}`);
}

function roleLabelsOn(labels) {
    return [...labels].filter((name) => name.startsWith("role:"));
}

// ---------------------------------------------------------------------------
// agent-dispatch.yml: `agent:go` on an issue
// ---------------------------------------------------------------------------

export async function handleDispatch({ github, context, core, env = process.env }) {
    const api = ops({ github, context });
    const payload = context.payload;
    if (payload.label?.name !== LABEL.go || !payload.issue || payload.issue.pull_request) {
        return core.info("Not an agent:go label on an issue; ignoring.");
    }
    if (!isHumanActor(payload.sender)) {
        return core.info(`Labeler @${payload.sender?.login} is not a human account; ignoring.`);
    }
    const sender = payload.sender.login;
    const role = await api.role(sender);
    if (!hasRole(role, "triage")) {
        return core.info(`@${sender} has role "${role}"; triage or higher is required. Ignoring.`);
    }
    const issue = await api.issue(payload.issue.number);
    const labels = labelNames(issue.labels);
    if (issue.state !== "open" || !labels.has(LABEL.go)) {
        return core.info(`Issue #${issue.number} is closed or no longer has ${LABEL.go}; ignoring.`);
    }
    if ((issue.assignees ?? []).some((assignee) => isCopilotAuthor(assignee.login))) {
        return core.info(`Issue #${issue.number} is already assigned to Copilot; ignoring.`);
    }
    if (labels.has(LABEL.active)) {
        return core.info(`Issue #${issue.number} already has ${LABEL.active}; ignoring.`);
    }
    if (labels.has(LABEL.needsHuman)) {
        await api.comment(issue.number, `Not starting: resolve the open questions, remove \`${LABEL.needsHuman}\`, then re-add \`${LABEL.go}\`.`);
        return core.info(`Issue #${issue.number} has ${LABEL.needsHuman}; not dispatching.`);
    }
    try {
        const maxActive = Number.parseInt(env.AGENT_MAX_ACTIVE ?? "", 10) || DEFAULT_MAX_ACTIVE;
        const open = await github.paginate(github.rest.issues.listForRepo, {
            owner: api.owner,
            repo: api.repo,
            state: "open",
            labels: LABEL.active,
            per_page: 100,
        });
        const active = open.filter((item) => !item.pull_request).length;
        if (active >= maxActive) {
            await api.comment(
                issue.number,
                `Queued: ${active} issues already have \`${LABEL.active}\` (limit ${maxActive}). \`${LABEL.go}\` stays on this issue; remove and re-add it when a slot frees up.`,
            );
            return core.info(`Active limit reached (${active}/${maxActive}).`);
        }
        const specPath = specPathFor(issue);
        const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
        // Clear state from any earlier run before starting again.
        await api.removeLabels(issue.number, [...CYCLE_LABELS, LABEL.ready, LABEL.review, ...roleLabelsOn(labels)], labels);
        await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${issue.number}/assignees`, {
            assignees: [COPILOT_ASSIGNEE],
            agent_assignment: {
                target_repo: api.fullName,
                base_branch: payload.repository?.default_branch ?? "main",
                custom_agent: "factory-orchestrator",
                model: "auto",
                custom_instructions: specInstructions({ issueNumber: issue.number, specPath }),
            },
        });
        await api.removeLabels(issue.number, [LABEL.go], labels);
        await api.addLabels(issue.number, [LABEL.active, LABEL.spec]);
        await api.comment(
            issue.number,
            `Assigned Copilot (\`factory-orchestrator\`, spec only). It will open a draft PR with \`${specPath}\`. Review the spec and comment \`/approve-spec\` on that PR to start the build.`,
        );
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, message: `dispatch failed: ${error.message}` });
        core.setFailed(error.message);
    }
}

// ---------------------------------------------------------------------------
// agent-gate.yml: `/approve-spec` comment
// ---------------------------------------------------------------------------

export async function handleApproveSpec({ github, context, core, env = process.env }) {
    const payload = context.payload;
    const body = String(payload.comment?.body ?? "").trim();
    if (!payload.issue?.pull_request || !/^\/approve-spec(?:\s|$)/.test(body)) {
        return core.info("Not an /approve-spec comment on a pull request; ignoring.");
    }
    if (!isHumanActor(payload.comment.user)) {
        return core.info(`Commenter @${payload.comment.user?.login} is not a human account; ignoring.`);
    }
    const api = ops({ github, context });
    const commenter = payload.comment.user.login;
    const role = await api.role(commenter);
    if (!hasRole(role, "write")) {
        return core.info(`@${commenter} has role "${role}"; write or higher is required. Ignoring.`);
    }
    const resolved = await resolvePipelinePr({ github, context, core }, payload.issue.number);
    if (!resolved) {
        return;
    }
    const { pr, issue, labels } = resolved;
    if (labels.has(LABEL.needsHuman)) {
        await api.comment(pr.number, `Not approving: issue #${issue.number} has \`${LABEL.needsHuman}\`. Resolve it, remove the label, and comment \`/approve-spec\` again.`);
        return;
    }
    if (!labels.has(LABEL.spec)) {
        return core.info(`Issue #${issue.number} is not at the spec gate (${LABEL.spec}); ignoring.`);
    }
    // The tasks API is the completion signal; `[WIP]` is only a fallback when it is unavailable.
    const session = await copilotSessionStatus({ core, env }, api, pr);
    if (session.state === "working") {
        await api.comment(pr.number, "Not approving: Copilot is still working on this pull request (a session is in progress or queued). Wait until it finishes, review the final spec, and comment `/approve-spec` again.");
        return;
    }
    if (session.state === "unknown" && isWipTitle(pr.title)) {
        await api.comment(pr.number, "Not approving: the Copilot session state could not be confirmed and the title still starts with `[WIP]`, so Copilot may still be working on it. Wait until it finishes and review the final spec. If Copilot has finished (no new spec commits), remove the `[WIP]` prefix yourself and comment `/approve-spec` again.");
        return;
    }
    const command = parseApproveCommand(body, pr.head.sha);
    if (!command.ok) {
        await api.comment(pr.number, `Not approving: ${command.reason}`);
        return;
    }
    const baseTitle = stripWipTitle(pr.title);
    try {
        if (baseTitle !== pr.title) {
            await api.setTitle(pr.number, baseTitle);
        }
        const specs = (await api.files(pr.number)).filter((file) => file.status !== "removed" && SPEC_FILE.test(file.filename));
        if (specs.length !== 1) {
            return await stopForHuman(api, {
                issueNumber: issue.number,
                commentOn: pr.number,
                message: `expected exactly one changed \`SPEC/*.md\` file in this PR, found ${specs.length}.`,
            });
        }
        const specPath = specs[0].filename;
        const delegation = parseDelegation(await api.fileAt(specPath, pr.head.sha));
        if (delegation.errors.length > 0) {
            return await stopForHuman(api, {
                issueNumber: issue.number,
                commentOn: pr.number,
                message: `\`${specPath}\` has an invalid Delegation section:\n\n${delegation.errors.map((error) => `- ${error}`).join("\n")}`,
            });
        }
        const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
        const linked = fillLinkedIssue(pr.body, issue.number);
        if (linked !== null) {
            try {
                await api.setBody(pr.number, linked);
            } catch (error) {
                core.warning(`Could not fill "Linked issue" in PR #${pr.number}: ${error.message}`);
            }
        }
        // Mark the PR as work in progress again while the build runs.
        await api.setTitle(pr.number, `[WIP] ${baseTitle}`);
        const roles = roleLabelsFor(delegation.steps);
        const staleRoles = Object.values(BUILD_PROFILES).filter((label) => !roles.includes(label));
        await api.removeLabels(issue.number, [LABEL.spec, ...staleRoles], labels);
        await api.addLabels(issue.number, [LABEL.ready, ...roles]);
        await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${issue.number}/comments`, {
            body: `Spec approved by @${commenter} at \`${pr.head.sha.slice(0, 7)}\`; this issue is bound to PR #${pr.number}.\n\n${gateMarker("bound", pr.number)}`,
        });
        await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${pr.number}/comments`, {
            body: buildInstructions({ specPath, steps: delegation.steps, qaDepth: delegation.qaDepth, sha: pr.head.sha }),
        });
        for (const warning of delegation.warnings) {
            core.warning(warning);
        }
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `spec approval failed: ${error.message}` });
        core.setFailed(error.message);
    }
}

// ---------------------------------------------------------------------------
// agent-gate.yml: pull_request_target events
// ---------------------------------------------------------------------------

export async function handlePullRequestEvent({ github, context, core, env = process.env }) {
    const payload = context.payload;
    if (payload.action === "closed") {
        return handleClosed({ github, context, core });
    }
    if (payload.action === "synchronize") {
        // Before any issue resolution, so a PR with zero or several linked issues cannot keep auto-merge on.
        await disableStaleAutoMerge({ github, context, core, env }, payload.pull_request.number);
    }
    const resolved = await resolvePipelinePr({ github, context, core }, payload.pull_request.number);
    if (!resolved) {
        return;
    }
    const { api, pr, issue, labels } = resolved;
    try {
        if (labels.has(LABEL.needsHuman) || !labels.has(LABEL.ready) || pr.state !== "open") {
            return core.info(`Issue #${issue.number} is not waiting for the build to finish; nothing to do.`);
        }
        // Only an explicit ready_for_review counts here; a draft is finished by detectCompletion
        // (Copilot session state), never because its title lacks [WIP].
        if (pr.draft || payload.action !== "ready_for_review") {
            return core.info(`PR #${pr.number} was not just marked ready for review; waiting for the Copilot session to end.`);
        }
        const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
        await markBuildReady({ api, pat, pr, issue, labels });
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `pull request update failed: ${error.message}` });
        core.setFailed(error.message);
    }
}

/** The build (or fix) finished: check the binding, mark a draft ready, and move the issue to `status:review`. */
async function markBuildReady({ api, pat, pr, issue, labels }) {
    if (!hasTrustedMarker(await api.comments(issue.number), gateMarker("bound", pr.number), await pat.login())) {
        return await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `PR #${pr.number} was not bound to issue #${issue.number} by \`/approve-spec\`.` });
    }
    if (pr.draft) {
        await pat.graphql(MUTATIONS.markReady, { id: pr.node_id });
        await api.comment(pr.number, "Build finished: marked ready for review. Copilot code review, factory review, and factory QA run next.");
    }
    await api.removeLabels(issue.number, [LABEL.ready], labels);
    await api.addLabels(issue.number, [LABEL.review]);
}

// ---------------------------------------------------------------------------
// agent-gate.yml: Copilot finished a session (completion detection)
// ---------------------------------------------------------------------------

const COMPLETION_RETRIES = 3;
const COMPLETION_RETRY_MS = 20_000;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Copilot cannot edit PR titles or bodies, so the gate owns `[WIP]`: once the
 * tasks API shows no Copilot session in progress or queued, strip `[WIP]` and,
 * at `status:ready`, mark the build ready. `unknown` and `working` do nothing.
 */
async function detectCompletion({ github, context, core, env, sleep = defaultSleep, retries = 0 }, pullNumber) {
    for (let attempt = 0; ; attempt++) {
        // Re-read the PR and labels on every attempt so writes never use state from before a sleep.
        const resolved = await resolvePipelinePr({ github, context, core }, pullNumber);
        if (!resolved) {
            return;
        }
        const { api, pr, issue, labels } = resolved;
        if (pr.state !== "open" || labels.has(LABEL.needsHuman)) {
            return core.info(`PR #${pr.number} is closed or issue #${issue.number} has ${LABEL.needsHuman}; not checking completion.`);
        }
        const awaitingBuild = labels.has(LABEL.ready) && (pr.draft || isWipTitle(pr.title));
        if (!isWipTitle(pr.title) && !awaitingBuild) {
            return core.info(`PR #${pr.number} has no [WIP] title and is not waiting for a build; nothing to do.`);
        }
        let since = null;
        if (awaitingBuild) {
            // Only a session started after the latest build/fix hand-off can finish it.
            try {
                since = latestHandoffAt(await api.comments(pr.number), await createPatClient(env.COPILOT_ASSIGN_TOKEN).login());
            } catch (error) {
                core.warning(`Could not read the hand-off comments for PR #${pr.number}: ${error.message}`);
                return;
            }
            if (!since) {
                return core.info(`PR #${pr.number} has no build or fix hand-off comment; not marking it finished.`);
            }
        }
        const session = await copilotSessionStatus({ core, env }, api, pr, since);
        if (session.state === "working" && attempt < retries) {
            await sleep(COMPLETION_RETRY_MS);
            continue;
        }
        if (session.state !== "done") {
            return core.info(`Copilot session on PR #${pr.number} is ${session.state}; not marking it finished.`);
        }
        return await finishCompletion({ api, core, env, pr, issue, labels, awaitingBuild });
    }
}

async function finishCompletion({ api, core, env, pr, issue, labels, awaitingBuild }) {
    try {
        if (isWipTitle(pr.title)) {
            await api.setTitle(pr.number, stripWipTitle(pr.title));
        }
        if (awaitingBuild) {
            await markBuildReady({ api, pat: createPatClient(env.COPILOT_ASSIGN_TOKEN), pr, issue, labels });
        }
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `completion handling failed: ${error.message}` });
        core.setFailed(error.message);
    }
}

export async function handleCopilotComment({ github, context, core, env = process.env, sleep = defaultSleep }) {
    const payload = context.payload;
    if (payload.action !== "created" || !payload.issue?.pull_request || !isCopilotBotUser(payload.comment?.user)) {
        return core.info("Not a Copilot bot comment on a pull request; ignoring.");
    }
    await detectCompletion({ github, context, core, env, sleep, retries: COMPLETION_RETRIES }, payload.issue.number);
}

/**
 * Auto-merge was enabled for a reviewed head; a new push needs fresh review and
 * QA. Disable it with the PAT, falling back to GITHUB_TOKEN; if both fail, stop
 * the pipeline when the issue is resolvable and throw so the job fails visibly.
 */
async function disableStaleAutoMerge({ github, context, core, env }, pullNumber) {
    const api = ops({ github, context });
    const { data: pr } = await github.rest.pulls.get({ owner: api.owner, repo: api.repo, pull_number: pullNumber });
    if (!isPipelinePr(pr, api.fullName) || !pr.auto_merge) {
        return;
    }
    const errors = [];
    let disabled = false;
    try {
        await createPatClient(env.COPILOT_ASSIGN_TOKEN).graphql(MUTATIONS.disableAutoMerge, { id: pr.node_id });
        disabled = true;
    } catch (error) {
        errors.push(`PAT: ${error.message}`);
        core.warning(`Disabling auto-merge with the PAT failed (${error.message}); retrying with GITHUB_TOKEN.`);
        try {
            await github.graphql(MUTATIONS.disableAutoMerge, { id: pr.node_id });
            disabled = true;
        } catch (fallbackError) {
            errors.push(`GITHUB_TOKEN: ${fallbackError.message}`);
        }
    }
    const head = pr.head.sha.slice(0, 7);
    if (disabled) {
        await api.comment(pr.number, `New commits after auto-merge was enabled: auto-merge disabled. Factory review and QA must pass again for \`${head}\`.`);
        return;
    }
    const message = `could not disable auto-merge on PR #${pr.number} after new commits (\`${head}\`): ${errors.join("; ")}. Disable it manually.`;
    try {
        const resolved = await resolvePipelinePr({ github, context, core }, pr.number);
        if (resolved) {
            await stopForHuman(api, { issueNumber: resolved.issue.number, commentOn: pr.number, message });
        } else {
            await api.comment(pr.number, `**Agent pipeline:** ${message}`);
        }
    } catch (reportError) {
        core.warning(`Could not report the auto-merge failure: ${reportError.message}`);
    }
    throw new Error(message);
}

async function handleClosed({ github, context, core }) {
    const resolved = await resolvePipelinePr({ github, context, core }, context.payload.pull_request.number);
    if (!resolved) {
        return;
    }
    const { api, pr, issue, labels } = resolved;
    if (!pr.merged) {
        await api.removeLabels(issue.number, [LABEL.active, ...CYCLE_LABELS, LABEL.ready, LABEL.review, ...roleLabelsOn(labels)], labels);
        await api.addLabels(issue.number, [LABEL.needsHuman]);
        await api.comment(issue.number, `PR #${pr.number} was closed without merging; the agent pipeline stopped (\`${LABEL.needsHuman}\`).`);
        return;
    }
    await api.removeLabels(issue.number, [LABEL.active, LABEL.needsHuman, ...STATUS_LABELS, ...CYCLE_LABELS], labels);
    const { items, skipped } = parseFollowUps(pr.body);
    const created = [];
    for (const text of items) {
        const { data } = await github.rest.issues.create({
            owner: api.owner,
            repo: api.repo,
            title: followUpTitle(pr.number, text),
            labels: ["follow-up"],
            body: `Deferred from PR #${pr.number} (issue #${issue.number}).\n\n${quote(text)}`,
        });
        created.push(`#${data.number}`);
    }
    const note = created.length > 0 ? ` Follow-ups filed: ${created.join(", ")}.` : "";
    const cap = skipped > 0 ? ` ${skipped} more follow-up(s) were not filed (limit ${MAX_FOLLOW_UPS}); see the PR.` : "";
    await api.comment(issue.number, `PR #${pr.number} merged; agent pipeline finished.${note}${cap}`);
}

// ---------------------------------------------------------------------------
// agent-gate.yml: review / QA / CI completion
// ---------------------------------------------------------------------------

export async function handleWorkflowRun({ github, context, core, env = process.env }) {
    const run = context.payload.workflow_run;
    if (!run || run.event !== "pull_request") {
        return core.info("Not a pull_request workflow run; ignoring.");
    }
    const { owner, repo } = context.repo;
    let numbers = (run.pull_requests ?? []).map((pull) => pull.number);
    if (numbers.length === 0) {
        const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: run.head_sha });
        numbers = data.filter((pull) => pull.state === "open").map((pull) => pull.number);
    }
    for (const number of numbers) {
        await evaluatePullRequest({ github, context, core, env }, number, run.head_sha);
    }
}

export async function handleManualEvaluate({ github, context, core, env = process.env }) {
    const number = Number(env.PR_NUMBER);
    if (!Number.isInteger(number) || number <= 0) {
        return core.setFailed("pr_number must be a positive integer.");
    }
    // Copilot cannot remove `[WIP]` itself; finish a completed build first, then evaluate gates.
    await detectCompletion({ github, context, core, env }, number);
    await evaluatePullRequest({ github, context, core, env }, number, null);
}

async function requiredContexts(github, owner, repo, branch) {
    const { data } = await github.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", { owner, repo, branch });
    const contexts = data
        .filter((rule) => rule.type === "required_status_checks")
        .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check.context));
    return [...new Set(contexts)];
}

async function latestWorkflowRun(github, owner, repo, file, head_sha) {
    const { data } = await github.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: file, head_sha, per_page: 20 });
    return latestRunState(data.workflow_runs, file);
}

async function evaluatePullRequest({ github, context, core, env }, pullNumber, expectedSha) {
    const resolved = await resolvePipelinePr({ github, context, core }, pullNumber);
    if (!resolved) {
        return;
    }
    const { api, pr, issue, labels } = resolved;
    const sha = pr.head.sha;
    if (pr.state !== "open" || pr.draft || !labels.has(LABEL.review) || labels.has(LABEL.needsHuman)) {
        return core.info(`PR #${pr.number} is not in review (draft, closed, missing ${LABEL.review}, or ${LABEL.needsHuman}); nothing to do.`);
    }
    if (expectedSha && expectedSha !== sha) {
        return core.info(`Run is for ${expectedSha}, but the PR head is ${sha}; waiting for the current head.`);
    }
    try {
        const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
        const patLogin = await pat.login();
        if (!hasTrustedMarker(await api.comments(issue.number), gateMarker("bound", pr.number), patLogin)) {
            return await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `PR #${pr.number} was not bound to issue #${issue.number} by \`/approve-spec\`.` });
        }
        const [review, qa] = await Promise.all([
            latestWorkflowRun(github, api.owner, api.repo, REVIEW_WORKFLOW_FILE, sha),
            latestWorkflowRun(github, api.owner, api.repo, QA_WORKFLOW_FILE, sha),
        ]);
        if (!review.done || !qa.done) {
            return core.info(`Waiting for factory review (${review.run?.status ?? "not started"}) and QA (${qa.run?.status ?? "not started"}) on ${sha}.`);
        }
        const reviews = await github.paginate(github.rest.pulls.listReviews, { owner: api.owner, repo: api.repo, pull_number: pr.number, per_page: 100 });
        const comments = await api.comments(pr.number);
        const factoryReview = review.run.conclusion === "success" ? pickFactoryReview(reviews, sha, review.run.run_started_at ?? review.run.created_at) : null;
        const qaVerdict = findQaVerdict(comments, sha, qa.run.id);
        const contexts = await requiredContexts(github, api.owner, api.repo, pr.base.ref);
        const checkRuns = await github.paginate(github.rest.checks.listForRef, { owner: api.owner, repo: api.repo, ref: sha, per_page: 100 });
        const { data: combined } = await github.rest.repos.getCombinedStatusForRef({ owner: api.owner, repo: api.repo, ref: sha });
        const checks = requiredChecksState(contexts, checkRuns, combined.statuses);

        const blockers = [];
        if (factoryReview?.state === "CHANGES_REQUESTED") {
            const lines = reviewBlockers(factoryReview.body);
            blockers.push({ source: "Factory review (changes requested)", details: quote(lines.length > 0 ? lines.join("\n") : factoryReview.body) });
        }
        if (qaVerdict?.verdict === "fail") {
            blockers.push({ source: "Factory QA (fail)", details: quote(qaVerdict.comment.body) });
        }
        if (checks.state === "failure") {
            blockers.push({ source: "Required checks failing", details: checks.failing.map((name) => `- ${name}`).join("\n") });
        }
        if (blockers.length > 0) {
            if (hasTrustedMarker(comments, gateMarker("fix", sha), patLogin)) {
                // A fix was requested for this exact head and the PR came back for review without new commits.
                const session = await copilotSessionStatus({ core, env }, api, pr);
                if (session.state === "working") {
                    return core.info(`Fix request for ${sha} already posted and Copilot is still working; waiting.`);
                }
                return await stopForHuman(api, {
                    issueNumber: issue.number,
                    commentOn: pr.number,
                    message: [
                        `blockers were raised again on \`${sha.slice(0, 7)}\`, the head a fix was already requested for, and Copilot's session ended without new commits (session state: ${session.state}).`,
                        "This may be a false positive (for example a review finding that the head commit already resolves). Check each blocker against the head. If it is false: dismiss the factory review, remove `agent:needs-human`, then re-run the Factory Review run for this head (`gh run rerun <id>`), which re-triggers the gate. Dismissing the review alone does not restart the pipeline. If it is real, push a fix or comment `@copilot` with the change.",
                        "",
                        ...blockers.flatMap(({ source, details }) => [`**${source}**`, "", details, ""]),
                    ].join("\n"),
                });
            }
            const cycle = nextCycle(labels);
            if (cycle.exhausted) {
                return await stopForHuman(api, {
                    issueNumber: issue.number,
                    commentOn: pr.number,
                    message: `blockers remain after \`${LABEL.cycle2}\` (D050 review/fix cap): ${blockers.map(({ source }) => source).join("; ")}.`,
                });
            }
            const steps = await delegationSteps(api, pr);
            // Back to draft + [WIP] so one fresh review/QA runs only after Copilot finishes the fix.
            await pat.graphql(MUTATIONS.toDraft, { id: pr.node_id });
            if (!isWipTitle(pr.title)) {
                await api.setTitle(pr.number, `[WIP] ${pr.title}`);
            }
            await api.removeLabels(issue.number, [LABEL.review], labels);
            await api.addLabels(issue.number, [LABEL.ready, cycle.label]);
            await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${pr.number}/comments`, {
                body: fixInstructions({ blockers, cycleLabel: cycle.label, steps, sha }),
            });
            return;
        }

        const missing = [];
        if (factoryReview?.state !== "APPROVED") {
            missing.push(`factory review approval (got ${factoryReview?.state ?? "no trusted review"})`);
        }
        if (!qaVerdict) {
            missing.push("a trusted factory QA verdict");
        }
        if (missing.length > 0) {
            return await stopForHuman(api, {
                issueNumber: issue.number,
                commentOn: pr.number,
                message: `review and QA finished for ${sha.slice(0, 7)} without ${missing.join(" or ")}.`,
            });
        }
        if (checks.state === "pending") {
            return core.info(`Waiting for required checks: ${checks.pending.join(", ")}.`);
        }
        if (!hasCopilotReview(reviews)) {
            return core.info("Waiting for Copilot code review.");
        }

        const decision = mergeDecision({ labels, files: await api.allFiles(pr.number) });
        if (decision.action === "auto-merge") {
            if (pr.auto_merge) {
                return core.info(`Auto-merge is already enabled on PR #${pr.number}.`);
            }
            if ((await copilotSessionStatus({ core, env }, api, pr)).state === "working") {
                return core.info(`Copilot is still working on PR #${pr.number}; not enabling auto-merge yet.`);
            }
            await enableAutoMerge(pat, api, pr);
            await api.comment(pr.number, `All gates green for \`${sha.slice(0, 7)}\` (required checks, Copilot code review, factory review, factory QA). Low-risk type: squash auto-merge enabled for this head only (D057).`);
            return;
        }
        const reason =
            decision.reason === "sensitive-paths"
                ? `this PR changes sensitive paths (${decision.sensitive.map((path) => `\`${path}\``).join(", ")}), which never auto-merge.`
                : `issue #${issue.number} is not a low-risk type (D057: type:feature, type:bug, and playtest need a human merge; auto-merge needs type:docs, type:chore, or follow-up).`;
        const reviewer = env.AGENT_MERGE_REVIEWER || api.owner;
        await api.addLabels(issue.number, [LABEL.needsHuman]);
        try {
            await github.rest.pulls.requestReviewers({ owner: api.owner, repo: api.repo, pull_number: pr.number, reviewers: [reviewer] });
        } catch (error) {
            core.warning(`Could not request a review from @${reviewer}: ${error.message}`);
        }
        await api.comment(pr.number, `All gates green; ready for a human merge (\`${LABEL.needsHuman}\`): ${reason} @${reviewer}, please review and merge.`);
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `gate evaluation failed: ${error.message}` });
        core.setFailed(error.message);
    }
}

async function delegationSteps(api, pr) {
    try {
        const spec = (await api.files(pr.number)).find((file) => file.status !== "removed" && SPEC_FILE.test(file.filename));
        return spec ? parseDelegation(await api.fileAt(spec.filename, pr.head.sha)).steps : [];
    } catch {
        return [];
    }
}

/** Enable squash auto-merge bound to the reviewed head; merge directly (same SHA) if the PR is already clean. */
async function enableAutoMerge(pat, api, pr) {
    try {
        await pat.graphql(MUTATIONS.enableAutoMerge, { id: pr.node_id, sha: pr.head.sha });
    } catch (error) {
        if (!/clean status/i.test(error.message)) {
            throw error;
        }
        await pat.request("PUT", `/repos/${api.owner}/${api.repo}/pulls/${pr.number}/merge`, { merge_method: "squash", sha: pr.head.sha });
    }
}
