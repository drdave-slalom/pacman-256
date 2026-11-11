// Agent pipeline glue (SPEC/github-agent-pipeline.md, D056).
//
// Loaded by agent-dispatch.yml and agent-gate.yml through actions/github-script
// from a checkout of the default branch, never from pull request code. The pure
// helpers are unit-tested in agent-gate.test.mjs; the handlers receive the
// github-script `github`, `context`, and `core` objects plus `process.env`.
// All issue, PR, comment, and spec text is untrusted and handled only as data.

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
export const SENSITIVE_BASENAMES = Object.freeze(["Dockerfile", "package.json", "package-lock.json"]);

export const COPILOT_ASSIGNEE = "copilot-swe-agent[bot]";
export const FACTORY_BOT_LOGIN = "github-actions[bot]";
export const REVIEW_WORKFLOW_FILE = "factory-review.lock.yml";
export const QA_WORKFLOW_FILE = "factory-qa.lock.yml";
export const QA_PASS_MARKER = "<!-- factory-qa:pass -->";
export const QA_FAIL_MARKER = "<!-- factory-qa:fail -->";

const COPILOT_AUTHORS = new Set(["copilot", "copilot-swe-agent", "copilot-swe-agent[bot]", "app/copilot-swe-agent"]);
const COPILOT_REVIEWERS = new Set(["copilot-pull-request-reviewer", "copilot-pull-request-reviewer[bot]"]);
const ROLE_RANK = Object.freeze({ none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 });
const MAX_QUOTE_LENGTH = 3000;
const SPEC_FILE = /^SPEC\/[^/]+\.md$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True for the Copilot cloud agent's author logins (REST and GraphQL forms). */
export function isCopilotAuthor(login) {
    return typeof login === "string" && COPILOT_AUTHORS.has(login.toLowerCase());
}

export function isCopilotReviewer(login) {
    return typeof login === "string" && COPILOT_REVIEWERS.has(login.toLowerCase());
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
    return new Set((labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean));
}

export function isWipTitle(title) {
    return /^\s*\[WIP\]/i.test(title ?? "");
}

export function stripHtmlComments(text) {
    return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** Issue numbers referenced with a GitHub closing keyword (`Closes #12`, `Fixes #12`, ...), in order. */
export function parseLinkedIssues(body) {
    const numbers = [];
    const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)\b/gi;
    for (const match of stripHtmlComments(body).matchAll(pattern)) {
        const number = Number(match[1]);
        if (!numbers.includes(number)) {
            numbers.push(number);
        }
    }
    return numbers;
}

/** Text of a `## <heading>` section up to the next level-1 or level-2 heading, or null. */
export function extractSection(markdown, heading) {
    const lines = String(markdown ?? "").split(/\r?\n/);
    const wanted = heading.toLowerCase();
    const start = lines.findIndex((line) => /^##\s+/.test(line) && line.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
    if (start === -1) {
        return null;
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * Parse a spec's `## Delegation` section: ordered `- <profile>: <task>` steps
 * plus a `QA depth: fast|slow` line. Returns errors instead of guessing; a
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
    for (const rawLine of stripHtmlComments(section).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const plain = line.replace(LIST_ITEM, "$1").replace(/[`*]/g, "").trim();
        const qa = /^qa[\s_-]*depth\b\s*[:=]?\s*(.*)$/i.exec(plain);
        if (qa) {
            const value = qa[1].trim().toLowerCase().replace(/[.\s].*$/, "");
            if (QA_DEPTHS.includes(value)) {
                qaDepth = value;
            } else {
                errors.push(`QA depth must be \`fast\` or \`slow\`, not "${qa[1].trim()}".`);
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

/** Items under `## Follow-ups` (top-level list items, skipping None/N/A), capped at `max`. */
export function parseFollowUps(body, max = MAX_FOLLOW_UPS) {
    const beforeGenerated = String(body ?? "").split("<!-- auto-generated-pr-description:start -->")[0];
    const section = extractSection(stripHtmlComments(beforeGenerated), "Follow-ups");
    if (section === null) {
        return { items: [], skipped: 0 };
    }
    const items = [];
    for (const line of section.split(/\r?\n/)) {
        const item = LIST_ITEM.exec(line);
        if (!item) {
            continue;
        }
        const text = item[1].replace(/^\[[ xX]\]\s*/, "").trim();
        if (!text || /^(?:none|n\/?a|nothing)\.?$/i.test(text)) {
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
    const path = String(filename ?? "").replace(/^\.\//, "");
    const basename = path.split("/").pop();
    return SENSITIVE_PREFIXES.some((prefix) => path.startsWith(prefix)) || SENSITIVE_BASENAMES.includes(basename);
}

/** Sensitive paths touched by a list of PR files (`{ filename, previous_filename }` or strings). */
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
 * D056 merge rule once every gate is green: sensitive paths always need a
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

/** Latest factory-reviewer review for the head SHA (the reviewer posts as github-actions[bot]). */
export function pickFactoryReview(reviews, sha) {
    const matching = (reviews ?? []).filter(
        (review) => review?.user?.login === FACTORY_BOT_LOGIN && review.commit_id === sha && review.state !== "PENDING" && review.state !== "DISMISSED",
    );
    return matching.at(-1) ?? null;
}

export function hasCopilotReview(reviews) {
    return (reviews ?? []).some((review) => isCopilotReviewer(review?.user?.login) && review.state !== "PENDING");
}

/** Latest factory-qa verdict comment for the head SHA (posted by github-actions[bot]). */
export function findQaVerdict(comments, sha) {
    let verdict = null;
    for (const comment of comments ?? []) {
        const body = String(comment?.body ?? "");
        if (comment?.user?.login !== FACTORY_BOT_LOGIN || !sha || !body.includes(sha)) {
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

/** Latest `pull_request` run of a workflow; `done` once completed and not skipped. */
export function latestRunState(runs) {
    const latest = (runs ?? [])
        .filter((run) => run.event === "pull_request")
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id)
        .at(-1);
    if (!latest) {
        return { done: false, run: null };
    }
    return { done: latest.status === "completed" && latest.conclusion !== "skipped", run: latest };
}

export function quote(text, limit = MAX_QUOTE_LENGTH) {
    const clean = stripHtmlComments(text).trim();
    const clipped = clean.length > limit ? `${clean.slice(0, limit)}\n…(truncated)` : clean;
    return clipped
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
}

export function gateMarker(kind, sha) {
    return `<!-- agent-gate:${kind} sha=${sha} -->`;
}

// ---------------------------------------------------------------------------
// Instruction text
// ---------------------------------------------------------------------------

export function specInstructions({ issueNumber, specPath }) {
    return [
        `Spec only: do not implement anything. Act as the factory-orchestrator (cloud mode) for issue #${issueNumber}.`,
        "1. Read AGENTS.md, docs/FACTORY.md, docs/DECISIONS.md, docs/GAME-CONTRACT.md, and the issue.",
        `2. Write ${specPath}: goal, acceptance criteria, validation commands, and out-of-scope items. Keep it short.`,
        "3. Include a `## Delegation` section listing the ordered build steps, one per line, as `- <profile>: <task>`. Use only these profiles: builder, artist, gameplay-designer, docs-writer. Add one line `- QA depth: fast` or `- QA depth: slow`.",
        `4. Open a draft pull request that contains only the spec. Fill .github/pull_request_template.md and put \`Closes #${issueNumber}\` under "Linked issue".`,
        "5. Stop. Do not write code. A human approves the spec by commenting /approve-spec on the pull request.",
    ].join("\n");
}

export function buildInstructions({ issueNumber, specPath, steps, qaDepth }) {
    const stepLines = steps.map(
        ({ profile, task }, index) =>
            `${index + 1}. **${profile}**: ${task}\n   Act as \`.github/agents/${profile}.agent.md\` for this step (delegate to that custom agent if it is available).`,
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
        "- Run `npm run check` after each step; it must pass before you finish.",
        `- Fill \`.github/pull_request_template.md\` in the pull request body, with \`Closes #${issueNumber}\` under "Linked issue". Keep the empty \`<!-- auto-generated-pr-description:start -->\` and \`<!-- auto-generated-pr-description:end -->\` markers.`,
        "- Leave the pull request as a draft. As your final step, when the build is complete and checks pass, remove the `[WIP]` prefix from the pull request title; the pipeline then marks it ready for review.",
    ].join("\n");
}

export function fixInstructions({ blockers, cycleLabel, steps, sha }) {
    const owners = steps.length > 0 ? [...new Set(steps.map(({ profile }) => `\`${profile}\``))].join(", ") : "the profile that owns the affected files";
    return [
        `@copilot Review/QA found blockers on ${sha.slice(0, 7)} (${cycleLabel}, D050). Fix only these, acting as the role agent from the spec's Delegation section that owns the affected files (${owners}). Run \`npm run check\` before you finish and keep the pull request template filled.`,
        "",
        ...blockers.flatMap(({ source, details }) => [`**${source}**`, "", details, ""]),
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
    return { request, graphql };
}

function ops({ github, context }) {
    const { owner, repo } = context.repo;
    return {
        owner,
        repo,
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
            for (const name of labels) {
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
        async fileAt(path, ref) {
            const { data } = await github.rest.repos.getContent({ owner, repo, path, ref });
            return Buffer.from(data.content ?? "", data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
        },
    };
}

/** Resolve a Copilot-authored PR whose linked issue carries `agent:active`, or null. */
async function resolvePipelinePr({ github, context, core }, pullNumber) {
    const api = ops({ github, context });
    const { data: pr } = await github.rest.pulls.get({ owner: api.owner, repo: api.repo, pull_number: pullNumber });
    if (!isCopilotAuthor(pr.user?.login)) {
        core.info(`PR #${pullNumber} is not authored by Copilot; ignoring.`);
        return null;
    }
    for (const number of parseLinkedIssues(pr.body)) {
        const issue = await api.issue(number);
        const labels = labelNames(issue.labels);
        if (!issue.pull_request && labels.has(LABEL.active)) {
            return { api, pr, issue, labels };
        }
    }
    core.info(`PR #${pullNumber} has no linked issue with ${LABEL.active}; ignoring.`);
    return null;
}

async function stopForHuman(api, { issueNumber, commentOn, message }) {
    await api.addLabels(issueNumber, [LABEL.needsHuman]);
    await api.comment(commentOn ?? issueNumber, `**Agent pipeline stopped** (\`${LABEL.needsHuman}\`): ${message}`);
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
    const sender = payload.sender?.login;
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
        await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${issue.number}/assignees`, {
            assignees: [COPILOT_ASSIGNEE],
            agent_assignment: {
                target_repo: `${api.owner}/${api.repo}`,
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
    const api = ops({ github, context });
    const commenter = payload.comment.user?.login;
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
    try {
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
        if (!isWipTitle(pr.title)) {
            // Mark the PR as work in progress again so the ready check waits for the build to finish.
            await github.rest.pulls.update({ owner: api.owner, repo: api.repo, pull_number: pr.number, title: `[WIP] ${pr.title}` });
        }
        const roles = roleLabelsFor(delegation.steps);
        const staleRoles = Object.values(BUILD_PROFILES).filter((label) => !roles.includes(label));
        await api.removeLabels(issue.number, [LABEL.spec, ...staleRoles], labels);
        await api.addLabels(issue.number, [LABEL.ready, ...roles]);
        await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${pr.number}/comments`, {
            body: buildInstructions({ issueNumber: issue.number, specPath, steps: delegation.steps, qaDepth: delegation.qaDepth }),
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
    const resolved = await resolvePipelinePr({ github, context, core }, payload.pull_request.number);
    if (!resolved) {
        return;
    }
    const { api, pr, issue, labels } = resolved;
    if (labels.has(LABEL.needsHuman) || !labels.has(LABEL.ready) || pr.state !== "open") {
        return core.info(`Issue #${issue.number} is not waiting for the build to finish; nothing to do.`);
    }
    try {
        if (pr.draft) {
            if (isWipTitle(pr.title)) {
                return core.info(`PR #${pr.number} is still [WIP]; waiting.`);
            }
            const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
            await pat.graphql("mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { number } } }", { id: pr.node_id });
            await api.comment(pr.number, "Build finished: marked ready for review. Copilot code review, factory review, and factory QA run next.");
        } else if (payload.action !== "ready_for_review") {
            return core.info(`PR #${pr.number} is not a draft but was not just marked ready; waiting.`);
        }
        await api.removeLabels(issue.number, [LABEL.ready], labels);
        await api.addLabels(issue.number, [LABEL.review]);
    } catch (error) {
        await stopForHuman(api, { issueNumber: issue.number, commentOn: pr.number, message: `could not mark the PR ready: ${error.message}` });
        core.setFailed(error.message);
    }
}

async function handleClosed({ github, context, core }) {
    const resolved = await resolvePipelinePr({ github, context, core }, context.payload.pull_request.number);
    if (!resolved) {
        return;
    }
    const { api, pr, issue, labels } = resolved;
    if (!pr.merged) {
        await api.removeLabels(issue.number, [LABEL.active], labels);
        await api.addLabels(issue.number, [LABEL.needsHuman]);
        await api.comment(issue.number, `PR #${pr.number} was closed without merging; the agent pipeline stopped (\`${LABEL.needsHuman}\`).`);
        return;
    }
    await api.removeLabels(issue.number, [LABEL.active, ...STATUS_LABELS], labels);
    const { items, skipped } = parseFollowUps(pr.body);
    const created = [];
    for (const text of items) {
        const { data } = await github.rest.issues.create({
            owner: api.owner,
            repo: api.repo,
            title: `Follow-up from #${pr.number}: ${text.length > 80 ? `${text.slice(0, 77)}...` : text}`,
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
    await evaluatePullRequest({ github, context, core, env }, number, null);
}

async function requiredContexts(github, owner, repo, branch) {
    const { data } = await github.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", { owner, repo, branch });
    const contexts = data
        .filter((rule) => rule.type === "required_status_checks")
        .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check.context));
    return [...new Set(contexts)];
}

async function latestWorkflowRun(github, owner, repo, workflow_id, head_sha) {
    const { data } = await github.rest.actions.listWorkflowRuns({ owner, repo, workflow_id, head_sha, per_page: 20 });
    return latestRunState(data.workflow_runs);
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
        const [review, qa] = await Promise.all([
            latestWorkflowRun(github, api.owner, api.repo, REVIEW_WORKFLOW_FILE, sha),
            latestWorkflowRun(github, api.owner, api.repo, QA_WORKFLOW_FILE, sha),
        ]);
        if (!review.done || !qa.done) {
            return core.info(`Waiting for factory review (${review.run?.status ?? "not started"}) and QA (${qa.run?.status ?? "not started"}) on ${sha}.`);
        }
        const reviews = await github.paginate(github.rest.pulls.listReviews, { owner: api.owner, repo: api.repo, pull_number: pr.number, per_page: 100 });
        const comments = await api.comments(pr.number);
        const factoryReview = pickFactoryReview(reviews, sha);
        const qaVerdict = findQaVerdict(comments, sha);
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
            if (comments.some((comment) => String(comment.body ?? "").includes(gateMarker("fix", sha)))) {
                return core.info(`Fix request for ${sha} already posted.`);
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
            const pat = createPatClient(env.COPILOT_ASSIGN_TOKEN);
            await api.addLabels(issue.number, [cycle.label]);
            await pat.request("POST", `/repos/${api.owner}/${api.repo}/issues/${pr.number}/comments`, {
                body: fixInstructions({ blockers, cycleLabel: cycle.label, steps, sha }),
            });
            return;
        }

        const missing = [];
        if (factoryReview?.state !== "APPROVED") {
            missing.push(`factory review approval (got ${factoryReview?.state ?? "no review"})`);
        }
        if (!qaVerdict) {
            missing.push("a factory QA verdict");
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

        const decision = mergeDecision({ labels, files: await api.files(pr.number) });
        if (decision.action === "auto-merge") {
            if (pr.auto_merge) {
                return core.info(`Auto-merge is already enabled on PR #${pr.number}.`);
            }
            await enableAutoMerge(createPatClient(env.COPILOT_ASSIGN_TOKEN), api, pr);
            await api.comment(pr.number, "All gates green (required checks, Copilot code review, factory review, factory QA). Low-risk type: squash auto-merge enabled (D056).");
            return;
        }
        const reason =
            decision.reason === "sensitive-paths"
                ? `this PR changes sensitive paths (${decision.sensitive.map((path) => `\`${path}\``).join(", ")}), which never auto-merge.`
                : `issue #${issue.number} is not a low-risk type (D056: type:feature, type:bug, and playtest need a human merge; auto-merge needs type:docs, type:chore, or follow-up).`;
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

async function enableAutoMerge(pat, api, pr) {
    try {
        await pat.graphql(
            "mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { pullRequest { number } } }",
            { id: pr.node_id },
        );
    } catch (error) {
        // GitHub refuses auto-merge when the PR can already merge ("clean status"); merge directly instead.
        if (!/clean status/i.test(error.message)) {
            throw error;
        }
        await pat.request("PUT", `/repos/${api.owner}/${api.repo}/pulls/${pr.number}/merge`, { merge_method: "squash", sha: pr.head.sha });
    }
}
