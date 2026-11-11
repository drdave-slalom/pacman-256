import assert from "node:assert/strict";
import test from "node:test";
import {
    BUILD_PROFILES,
    buildInstructions,
    copilotActivity,
    createPatClient,
    extractSection,
    fillLinkedIssue,
    findQaVerdict,
    fixInstructions,
    followUpTitle,
    gateMarker,
    handleApproveSpec,
    handleCopilotComment,
    handleDispatch,
    handleManualEvaluate,
    handlePullRequestEvent,
    handleWorkflowRun,
    hasCopilotReview,
    hasRole,
    hasTrustedMarker,
    isCopilotAuthor,
    isCopilotBotUser,
    isHumanActor,
    isPipelinePr,
    isSensitivePath,
    isWipTitle,
    latestRunState,
    mergeDecision,
    neutralizeMentions,
    nextCycle,
    parseApproveCommand,
    parseDelegation,
    parseFollowUps,
    parseLinkedIssues,
    pickFactoryReview,
    requiredChecksState,
    reviewBlockers,
    roleLabelsFor,
    sensitivePaths,
    specInstructions,
    specPathFor,
    stripWipTitle,
    taskMatchesPr,
} from "./agent-gate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO = "drdave-slalom/pacman-256";
const PAT_LOGIN = "drdave-slalom";
const BOT = { login: "github-actions[bot]", type: "Bot" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("sensitive paths: prefixes, manifests, Docker and npm config at any depth, case-insensitive", () => {
    for (const path of [
        ".github/workflows/ci.yml",
        ".GitHub/agents/builder.agent.md",
        "/.github/x",
        "deploy/README.md",
        "Dockerfile",
        "./Dockerfile",
        "apps/server/Dockerfile.dev",
        "DOCKERFILE.prod",
        ".dockerignore",
        "apps/client/.dockerignore",
        ".npmrc",
        "packages/shared/.npmrc",
        "scripts/sync-labels.mjs",
        "Scripts/x.sh",
        "package.json",
        "package-lock.json",
        "apps/client/package.json",
        "factory-control/server/src/index.ts",
    ]) {
        assert.equal(isSensitivePath(path), true, path);
    }
    for (const path of ["docs/FACTORY.md", "SPEC/T6-x.md", "apps/client/src/main.ts", "factory-control/web/src/app.ts", "README.md", "github/x", "deployment.md", "docs/dockerfile-notes.md"]) {
        assert.equal(isSensitivePath(path), false, path);
    }
    assert.deepEqual(
        sensitivePaths([{ filename: "docs/a.md" }, { filename: "docs/b.md", previous_filename: "scripts/b.md" }, "Dockerfile", { filename: "Dockerfile" }]),
        ["scripts/b.md", "Dockerfile"],
    );
});

test("merge eligibility: low-risk types auto-merge; the strictest label and sensitive paths win", () => {
    const docs = [{ filename: "docs/FACTORY.md" }];
    assert.equal(mergeDecision({ labels: ["type:docs"], files: docs }).action, "auto-merge");
    assert.equal(mergeDecision({ labels: [{ name: "type:chore" }], files: docs }).action, "auto-merge");
    assert.equal(mergeDecision({ labels: ["follow-up", "role:docs"], files: docs }).action, "auto-merge");
    for (const strict of ["type:feature", "type:bug", "playtest"]) {
        const decision = mergeDecision({ labels: ["type:docs", strict], files: docs });
        assert.deepEqual([decision.action, decision.reason], ["needs-human", "human-merge-type"], strict);
    }
    assert.equal(mergeDecision({ labels: ["role:builder"], files: docs }).reason, "no-low-risk-type");
    const sensitive = mergeDecision({ labels: ["type:docs"], files: [{ filename: ".github/workflows/ci.yml" }] });
    assert.deepEqual([sensitive.action, sensitive.reason, sensitive.sensitive], ["needs-human", "sensitive-paths", [".github/workflows/ci.yml"]]);
});

test("delegation parsing accepts ordered profile steps and QA depth", () => {
    const spec = [
        "# Spec",
        "## Goal",
        "- builder: not part of delegation",
        "## Delegation",
        "<!-- - artist: commented out -->",
        "1. `builder`: Implement the lobby counter",
        "- **docs-writer**: Update README for the counter",
        "  - nested detail: ignored",
        "```",
        "- artist: inside a fence is ignored",
        "## Not a heading inside a fence",
        "```",
        "- builder: Wire the counter into tests",
        "- QA depth: slow",
        "### Notes",
        "- gameplay-designer: a subheading ends the section",
    ].join("\n");
    const result = parseDelegation(spec);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.qaDepth, "slow");
    assert.deepEqual(result.steps, [
        { profile: "builder", task: "Implement the lobby counter" },
        { profile: "docs-writer", task: "Update README for the counter" },
        { profile: "builder", task: "Wire the counter into tests" },
    ]);
    assert.deepEqual(roleLabelsFor(result.steps), ["role:builder", "role:docs"]);
    assert.deepEqual(roleLabelsFor([{ profile: "artist" }, { profile: "gameplay-designer" }]), ["role:art", "role:design"]);
    assert.deepEqual(Object.keys(BUILD_PROFILES).sort(), ["artist", "builder", "docs-writer", "gameplay-designer"]);
});

test("delegation parsing reports unknown, malformed, missing, and duplicate entries instead of defaulting", () => {
    assert.deepEqual(parseDelegation("# Spec\n\nNo delegation.").errors, ["The spec has no `## Delegation` section."]);
    assert.deepEqual(parseDelegation("```\n## Delegation\n- builder: x\n```").errors, ["The spec has no `## Delegation` section."]);
    assert.match(parseDelegation("## Delegation\n- qa-tester: run tests\n- QA depth: fast").errors[0], /Unknown delegation profile "qa-tester"/);
    assert.match(parseDelegation("## Delegation\n- pr-reviewer: review").errors[0], /Unknown delegation profile/);
    assert.match(parseDelegation("## Delegation\n- just do it").errors[0], /not in the form/);
    assert.match(parseDelegation("## Delegation\n- QA depth: fast").errors[0], /lists no/);
    assert.match(parseDelegation("## Delegation\n- builder: x\n- QA depth: thorough").errors[0], /QA depth must be/);
    assert.deepEqual(parseDelegation("## Delegation\n- builder: x\n- QA depth: fast\n- QA depth: slow").errors, ["QA depth is given more than once."]);
    const noDepth = parseDelegation("## Delegation\n- builder: x");
    assert.deepEqual([noDepth.errors, noDepth.qaDepth, noDepth.warnings.length], [[], "fast", 1]);
    assert.equal(parseDelegation("## Delegation\n- artist: sprite\nQA depth: **fast**.").qaDepth, "fast");
});

test("follow-up parsing: None/N/A variants, heading variants, comments, fences, generated text, cap of five", () => {
    const body = [
        "## Linked issue",
        "Closes #4",
        "## Follow-ups",
        "<!-- Deferred findings; write None if empty. -->",
        "- Tighten the timer copy",
        "  - nested note",
        "* [ ] Add a phone screenshot",
        "1. Rename helper",
        "- N/A",
        "```",
        "- fenced, ignored",
        "```",
        "<!-- auto-generated-pr-description:start -->",
        "- not a follow-up",
        "<!-- auto-generated-pr-description:end -->",
    ].join("\n");
    assert.deepEqual(parseFollowUps(body), { items: ["Tighten the timer copy", "Add a phone screenshot", "Rename helper"], skipped: 0 });
    for (const none of ["- None", "- None.", "- None — all addressed in this PR.", "- _None_", "- *none*", "- N/A (docs only)", "- n/a", "- NA", "- Nothing."]) {
        assert.deepEqual(parseFollowUps(`## Follow-ups\n${none}`), { items: [], skipped: 0 }, none);
    }
    assert.deepEqual(parseFollowUps("## Follow-ups\n- Nonetheless rename x").items, ["Nonetheless rename x"]);
    for (const heading of ["## Follow ups", "## Followups", "## follow-ups"]) {
        assert.deepEqual(parseFollowUps(`${heading}\n- a`).items, ["a"], heading);
    }
    assert.deepEqual(parseFollowUps("## Summary\n- a"), { items: [], skipped: 0 });
    const many = `## Follow-ups\n${Array.from({ length: 7 }, (_, index) => `- item ${index + 1}`).join("\n")}\n## Next`;
    assert.deepEqual(parseFollowUps(many), { items: ["item 1", "item 2", "item 3", "item 4", "item 5"], skipped: 2 });
});

test("mentions are neutralised in follow-up titles and quotes", () => {
    assert.equal(neutralizeMentions("ping @drdave-slalom and @org/team, mail a@b"), "ping @\u200bdrdave-slalom and @\u200borg/team, mail a@\u200bb");
    assert.equal(followUpTitle(7, "Ask @copilot to rename"), "Follow-up from #7: Ask @\u200bcopilot to rename");
    assert.ok(followUpTitle(7, "x".repeat(200)).endsWith("..."));
});

test("cycle increment follows D050: cycle:1, then cycle:2, then exhausted", () => {
    assert.deepEqual(nextCycle([]), { exhausted: false, label: "cycle:1" });
    assert.deepEqual(nextCycle([{ name: "cycle:1" }]), { exhausted: false, label: "cycle:2" });
    assert.deepEqual(nextCycle(["cycle:1", "cycle:2"]), { exhausted: true, label: null });
    assert.deepEqual(nextCycle(["cycle:2"]), { exhausted: true, label: null });
});

test("linked issues come from closing keywords outside comments and the generated description", () => {
    assert.deepEqual(parseLinkedIssues("## Linked issue\n\n<!-- `Closes #<n>` -->\nCloses #\n\nCloses #12\n\nFixes #12, fixes: #7 and resolves #3"), [12, 7, 3]);
    assert.deepEqual(parseLinkedIssues("<!-- Closes #9 -->See #4"), []);
    assert.deepEqual(
        parseLinkedIssues("Closes #5\n<!-- auto-generated-pr-description:start -->\n## TL;DR\nFixes #6\n<!-- auto-generated-pr-description:end -->\nFixes #5"),
        [5],
    );
    assert.deepEqual(parseLinkedIssues("Closes #5\n<!-- auto-generated-pr-description:start -->\nFixes #6 (unterminated)"), [5]);
    assert.deepEqual(parseLinkedIssues(null), []);
});

test("actor, author, role, and title checks", () => {
    assert.equal(hasRole("triage", "triage"), true);
    assert.equal(hasRole("admin", "write"), true);
    assert.equal(hasRole("maintain", "write"), true);
    assert.equal(hasRole("read", "triage"), false);
    assert.equal(hasRole("triage", "write"), false);
    assert.equal(hasRole(undefined, "triage"), false);
    assert.throws(() => hasRole("admin", "owner"), /unknown role/);
    for (const login of ["Copilot", "copilot-swe-agent[bot]", "copilot-swe-agent", "app/copilot-swe-agent"]) {
        assert.equal(isCopilotAuthor(login), true, login);
    }
    assert.equal(isCopilotAuthor("drdave-slalom"), false);
    assert.equal(isHumanActor({ login: "drdave-slalom", type: "User" }), true);
    assert.equal(isHumanActor({ login: "github-actions[bot]", type: "Bot" }), false);
    assert.equal(isHumanActor({ login: "Copilot", type: "User" }), false);
    assert.equal(isHumanActor(undefined), false);
    const pr = { user: { login: "Copilot", type: "Bot" }, head: { repo: { full_name: REPO } } };
    assert.equal(isPipelinePr(pr, REPO), true);
    assert.equal(isPipelinePr({ ...pr, user: { login: "Copilot", type: "User" } }, REPO), false);
    assert.equal(isPipelinePr({ ...pr, head: { repo: { full_name: "fork/pacman-256" } } }, REPO), false);
    assert.equal(isPipelinePr({ ...pr, head: { repo: null } }, REPO), false);
    assert.equal(isWipTitle("[WIP] Add docs"), true);
    assert.equal(isWipTitle("Add docs [WIP]"), false);
    assert.equal(extractSection("## A\nx\n### sub\ny\n## B\nz", "a"), "x");
});

test("/approve-spec accepts an optional head SHA prefix of at least 7 characters", () => {
    assert.deepEqual(parseApproveCommand("/approve-spec", SHA), { ok: true });
    assert.deepEqual(parseApproveCommand("/approve-spec\nLooks good", SHA), { ok: true });
    assert.deepEqual(parseApproveCommand(`/approve-spec ${SHA.slice(0, 7)}`, SHA), { ok: true });
    assert.deepEqual(parseApproveCommand(`/approve-spec ${SHA.toUpperCase()}`, SHA), { ok: true });
    assert.match(parseApproveCommand("/approve-spec 012345", SHA).reason, /not a commit SHA/);
    assert.match(parseApproveCommand("/approve-spec looks-good", SHA).reason, /not a commit SHA/);
    assert.match(parseApproveCommand("/approve-spec abcdef0", SHA).reason, /does not match/);
});

test("review, QA, and check helpers read only trusted verdicts for the head SHA and run", () => {
    const reviews = [
        { user: BOT, commit_id: SHA, state: "CHANGES_REQUESTED", body: "x", submitted_at: "2026-01-01T00:05:00Z" },
        { user: { login: "mallory" }, commit_id: SHA, state: "APPROVED", submitted_at: "2026-01-01T00:06:00Z" },
        { user: BOT, commit_id: "old", state: "APPROVED", submitted_at: "2026-01-01T00:07:00Z" },
        { user: BOT, commit_id: SHA, state: "APPROVED", body: "ok", submitted_at: "2026-01-01T00:08:00Z" },
        { user: { login: "copilot-pull-request-reviewer[bot]" }, commit_id: "old", state: "COMMENTED" },
    ];
    assert.equal(pickFactoryReview(reviews, SHA).state, "APPROVED");
    assert.equal(pickFactoryReview(reviews, SHA, "2026-01-01T00:04:00Z").state, "APPROVED");
    assert.equal(pickFactoryReview(reviews, SHA, "2026-01-01T00:09:00Z"), null);
    assert.equal(pickFactoryReview(reviews, "other"), null);
    assert.equal(hasCopilotReview(reviews), true);
    assert.equal(hasCopilotReview(reviews.slice(0, 4)), false);

    const qa = (verdict, head = SHA, run = 202, user = BOT) => ({ user, body: `<!-- factory-qa:${verdict} -->\n## Factory QA\n\nHead: ${head}\nRun: ${run}\n\nresults` });
    assert.equal(findQaVerdict([qa("fail"), qa("pass", SHA, 202, { login: "mallory" })], SHA, 202).verdict, "fail");
    assert.equal(findQaVerdict([qa("fail"), qa("pass")], SHA, 202).verdict, "pass");
    assert.equal(findQaVerdict([qa("pass", SHA, 201)], SHA, 202), null);
    assert.equal(findQaVerdict([qa("pass", "old")], SHA, 202), null);
    assert.equal(findQaVerdict([{ user: BOT, body: `<!-- factory-qa:pass --><!-- factory-qa:fail -->\nHead: ${SHA}\nRun: 202` }], SHA, 202), null);
    assert.equal(findQaVerdict([{ user: BOT, body: `<!-- factory-qa:pass -->\nHead: ${SHA} Run: 202` }], SHA, 202), null);
    assert.equal(findQaVerdict([qa("pass")], SHA, undefined), null);

    assert.deepEqual(reviewBlockers("- [blocker] crash on join\n- [should] rename\n<!-- [blocker] hidden -->\n[BLOCKER] tests"), ["- [blocker] crash on join", "[BLOCKER] tests"]);

    const required = ["Validate (Node 22.18.0)", "Validate (Node 24.x)"];
    const ok = [
        { id: 1, name: "Validate (Node 22.18.0)", status: "completed", conclusion: "failure", started_at: "2026-01-01T00:00:00Z" },
        { id: 2, name: "Validate (Node 22.18.0)", status: "completed", conclusion: "success", started_at: "2026-01-01T01:00:00Z" },
        { id: 3, name: "Validate (Node 24.x)", status: "completed", conclusion: "success", started_at: "2026-01-01T00:00:00Z" },
    ];
    assert.deepEqual(requiredChecksState(required, ok, []), { state: "success", failing: [], pending: [] });
    assert.equal(requiredChecksState(required, ok.slice(0, 1), []).state, "failure");
    assert.deepEqual(requiredChecksState(required, ok.slice(1, 2), []).pending, ["Validate (Node 24.x)"]);
    assert.equal(requiredChecksState(["legacy"], [], [{ context: "legacy", state: "success" }]).state, "success");
    assert.equal(requiredChecksState(["legacy"], [], [{ context: "legacy", state: "error" }]).state, "failure");
    assert.equal(requiredChecksState([], [], []).state, "success");

    const path = ".github/workflows/factory-qa.lock.yml";
    assert.deepEqual(latestRunState([], "factory-qa.lock.yml"), { done: false, run: null });
    const runs = [
        { id: 1, path, event: "pull_request", created_at: "2026-01-01T00:00:00Z", status: "completed", conclusion: "skipped" },
        { id: 2, path, event: "pull_request", created_at: "2026-01-01T00:05:00Z", status: "in_progress", conclusion: null },
        { id: 3, path, event: "workflow_dispatch", created_at: "2026-01-01T00:09:00Z", status: "completed", conclusion: "success" },
        { id: 4, path: ".github/workflows/evil.yml", event: "pull_request", created_at: "2026-01-01T00:09:00Z", status: "completed", conclusion: "success" },
    ];
    assert.deepEqual([latestRunState(runs, "factory-qa.lock.yml").done, latestRunState(runs, "factory-qa.lock.yml").run.id], [false, 2]);
    assert.equal(latestRunState([{ ...runs[1], status: "completed", conclusion: "failure" }], "factory-qa.lock.yml").done, true);
    assert.equal(latestRunState([{ ...runs[1], path: `${path}@refs/heads/main`, status: "completed", conclusion: "success" }], "factory-qa.lock.yml").done, true);
    assert.equal(latestRunState(runs.slice(0, 1), "factory-qa.lock.yml").done, false);

    const marker = gateMarker("fix", SHA);
    assert.equal(hasTrustedMarker([{ user: { login: "mallory" }, body: marker }], marker, PAT_LOGIN), false);
    assert.equal(hasTrustedMarker([{ user: { login: PAT_LOGIN }, body: `x ${marker}` }], marker, PAT_LOGIN), true);
    assert.equal(hasTrustedMarker([{ user: { login: PAT_LOGIN }, body: marker }], marker, null), false);
    assert.equal(gateMarker("bound", 20), "<!-- agent-gate:bound pr=20 -->");
});

test("instruction text names the spec, profiles, and required rules, and never asks Copilot to edit the title or body", () => {
    const spec = specInstructions({ issueNumber: 9, specPath: "SPEC/issue-9-x.md" });
    assert.match(spec, /Spec only/);
    assert.match(spec, /issue #9/);
    assert.match(spec, /SPEC\/issue-9-x\.md/);
    assert.match(spec, /## Delegation/);
    assert.match(spec, /Do not use the task\/subagent tool/);
    assert.match(spec, /final step, post a pull request comment summarising/);
    const build = buildInstructions({ specPath: "SPEC/a.md", steps: [{ profile: "artist", task: "Draw" }], qaDepth: "fast", sha: SHA });
    assert.ok(build.endsWith(gateMarker("build", SHA)));
    assert.match(build, /^@copilot /);
    assert.match(build, /\.github\/agents\/artist\.agent\.md/);
    assert.match(build, /\.github\/skills\/artist\/SKILL\.md/);
    assert.match(build, /Do NOT use the task\/subagent tool or start custom agents/);
    assert.doesNotMatch(build, /delegate to that custom agent/);
    assert.match(build, /npm run check/);
    assert.match(build, /post a pull request comment summarising what you changed, the validation you ran/);
    const fix = fixInstructions({ blockers: [{ source: "QA", details: "> boom" }], cycleLabel: "cycle:1", steps: [], sha: SHA });
    assert.match(fix, /^@copilot /);
    assert.match(fix, /Do NOT use the task\/subagent tool/);
    assert.match(fix, /post a pull request comment summarising/);
    assert.match(fix, /false positive/);
    assert.ok(fix.endsWith(gateMarker("fix", SHA)));
    for (const [name, text] of Object.entries({ spec, build, fix })) {
        assert.doesNotMatch(text, /\[WIP\]/, name);
        assert.doesNotMatch(text, /pull_request_template|fill the (?:pr|pull request) template|keep the pull request template/i, name);
        assert.doesNotMatch(text, /(?:edit|update|fill|remove)[^.\n]*(?:pull request|PR) (?:title|body)/i, name);
        assert.doesNotMatch(text, /Linked issue/, name);
    }
});

test("PAT client sends bearer auth, caches the login, and surfaces API and GraphQL errors", async () => {
    assert.throws(() => createPatClient(""), /COPILOT_ASSIGN_TOKEN/);
    const calls = [];
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    const responses = [reply(201, { ok: true }), reply(422, { message: "Validation Failed" }), reply(200, { errors: [{ message: "clean status" }] }), reply(200, { login: "me" })];
    const pat = createPatClient("secret", async (url, init) => {
        calls.push([url, init]);
        return responses.shift();
    });
    assert.deepEqual(await pat.request("POST", "/repos/o/r/issues/1/assignees", { a: 1 }), { ok: true });
    assert.equal(calls[0][0], "https://api.github.com/repos/o/r/issues/1/assignees");
    assert.equal(calls[0][1].headers.Authorization, "Bearer secret");
    assert.equal(calls[0][1].body, '{"a":1}');
    await assert.rejects(pat.request("PUT", "/x"), /PUT \/x failed \(422\): Validation Failed/);
    await assert.rejects(pat.graphql("q", {}), /GraphQL error: clean status/);
    assert.equal(await pat.login(), "me");
    assert.equal(await pat.login(), "me");
    assert.equal(calls.length, 4);
});

// ---------------------------------------------------------------------------
// Handlers against a stateful fake GitHub
// ---------------------------------------------------------------------------

function fakeGitHub(seed = {}) {
    const state = {
        roles: { [PAT_LOGIN]: "admin", helper: "triage", stranger: null, ...seed.roles },
        issues: new Map(),
        comments: new Map(),
        prs: new Map(),
        files: seed.files ?? [{ filename: "docs/notes.md", status: "modified" }],
        commits: seed.commits ?? [{ sha: "c1", files: [{ filename: "docs/notes.md" }] }],
        fileContent: seed.fileContent ?? "",
        reviews: seed.reviews ?? [],
        runs: seed.runs ?? {},
        checkRuns: seed.checkRuns ?? [],
        statuses: seed.statuses ?? [],
        rules: seed.rules ?? [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "Validate (Node 22.18.0)" }] } }],
        activeIssues: seed.activeIssues ?? [],
        nextIssue: 500,
        nextComment: 1,
    };
    for (const issue of seed.issues ?? []) {
        state.issues.set(issue.number, { state: "open", title: "Issue", body: "", assignees: [], ...issue, labels: issue.labels.map((name) => ({ name })) });
    }
    for (const pr of seed.prs ?? []) {
        state.prs.set(pr.number, pr);
    }
    for (const [number, list] of Object.entries(seed.comments ?? {})) {
        state.comments.set(Number(number), list.map((comment) => ({ id: state.nextComment++, ...comment })));
    }
    const writes = [];
    const pat = [];
    const agentReads = [];
    const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
    const labelsOf = (number) => state.issues.get(number)?.labels.map(({ name }) => name) ?? [];
    const github = {
        graphql: async (query, variables) => {
            const mutation = /\{\s*(\w+)\(/.exec(query)[1];
            writes.push(["tokenGraphql", mutation, variables]);
            if (seed.tokenGraphqlError) {
                throw new Error(seed.tokenGraphqlError);
            }
            return {};
        },
        paginate: async (method, params) => (await method(params)).data,
        request: async () => ({ data: state.rules }),
        rest: {
            repos: {
                getCollaboratorPermissionLevel: async ({ username }) => {
                    const role = state.roles[username];
                    if (!role) {
                        throw notFound();
                    }
                    return { data: { role_name: role } };
                },
                getContent: async () => ({ data: { content: Buffer.from(state.fileContent).toString("base64"), encoding: "base64" } }),
                getCommit: async ({ ref }) => ({ data: { files: state.commits.find((commit) => commit.sha === ref)?.files ?? [] } }),
                getCombinedStatusForRef: async () => ({ data: { statuses: state.statuses } }),
                listPullRequestsAssociatedWithCommit: async () => ({ data: [...state.prs.values()] }),
            },
            issues: {
                get: async ({ issue_number }) => {
                    const issue = state.issues.get(issue_number);
                    if (!issue) {
                        throw notFound();
                    }
                    return { data: structuredClone(issue) };
                },
                listForRepo: async () => ({ data: state.activeIssues }),
                listComments: async ({ issue_number }) => ({ data: state.comments.get(issue_number) ?? [] }),
                addLabels: async ({ issue_number, labels }) => {
                    writes.push(["addLabels", issue_number, labels]);
                    const issue = state.issues.get(issue_number);
                    for (const name of labels) {
                        if (!issue.labels.some((label) => label.name === name)) {
                            issue.labels.push({ name });
                        }
                    }
                },
                removeLabel: async ({ issue_number, name }) => {
                    writes.push(["removeLabel", issue_number, name]);
                    const issue = state.issues.get(issue_number);
                    issue.labels = issue.labels.filter((label) => label.name !== name);
                },
                createComment: async ({ issue_number, body }) => {
                    writes.push(["comment", issue_number, body]);
                    state.comments.set(issue_number, [...(state.comments.get(issue_number) ?? []), { id: state.nextComment++, user: BOT, body }]);
                },
                create: async ({ title, labels, body }) => {
                    const number = state.nextIssue++;
                    writes.push(["createIssue", number, { title, labels, body }]);
                    return { data: { number } };
                },
            },
            pulls: {
                get: async ({ pull_number }) => ({ data: structuredClone(state.prs.get(pull_number)) }),
                listFiles: async () => ({ data: state.files }),
                listCommits: async () => ({ data: state.commits.map(({ sha }) => ({ sha })) }),
                listReviews: async () => ({ data: state.reviews }),
                update: async ({ pull_number, title, body }) => {
                    if (seed.updateBodyError && body !== undefined) {
                        throw new Error(seed.updateBodyError);
                    }
                    if (title !== undefined) {
                        writes.push(["setTitle", pull_number, title]);
                        state.prs.get(pull_number).title = title;
                    }
                    if (body !== undefined) {
                        writes.push(["setBody", pull_number, body]);
                        state.prs.get(pull_number).body = body;
                    }
                },
                requestReviewers: async ({ pull_number, reviewers }) => writes.push(["requestReviewers", pull_number, reviewers]),
            },
            actions: {
                listWorkflowRuns: async ({ workflow_id }) => ({ data: { workflow_runs: state.runs[workflow_id] ?? [] } }),
            },
            checks: {
                listForRef: async () => ({ data: state.checkRuns }),
            },
        },
    };
    const graphqlErrors = seed.graphqlErrors ?? {};
    const fetchImpl = async (url, init) => {
        const path = url.replace("https://api.github.com", "");
        const body = init.body ? JSON.parse(init.body) : undefined;
        let response = {};
        if (path === "/user") {
            response = { login: PAT_LOGIN };
        } else if (path.startsWith("/agents/")) {
            agentReads.push(path);
            if (seed.tasksError) {
                return { ok: false, status: seed.tasksError, text: async () => JSON.stringify({ message: "Agents API unavailable" }) };
            }
            const detail = /\/tasks\/([^/]+)$/.exec(path);
            const tasks = seed.tasks ?? [];
            response = detail ? tasks.find((task) => String(task.id) === decodeURIComponent(detail[1])) : { tasks: tasks.map(({ sessions, ...task }) => task) };
        } else if (path === "/graphql") {
            const mutation = /\{\s*(\w+)\(/.exec(body.query)[1];
            pat.push(["graphql", mutation, body.variables]);
            if (graphqlErrors[mutation]) {
                response = { errors: [{ message: graphqlErrors[mutation] }] };
            }
        } else {
            pat.push([init.method, path, body]);
            const comment = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(path);
            if (comment && init.method === "POST") {
                const number = Number(comment[1]);
                state.comments.set(number, [...(state.comments.get(number) ?? []), { id: state.nextComment++, user: { login: PAT_LOGIN, type: "User" }, body: body.body }]);
            }
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(response) };
    };
    const logs = [];
    const core = { info: (line) => logs.push(line), warning: (line) => logs.push(line), setFailed: (line) => writes.push(["failed", line]) };
    return { state, github, core, writes, pat, agentReads, logs, fetchImpl, labelsOf };
}

async function run(world, handler, payload, env = {}) {
    const original = globalThis.fetch;
    globalThis.fetch = world.fetchImpl;
    try {
        await handler({ github: world.github, context: { repo: { owner: "drdave-slalom", repo: "pacman-256" }, payload }, core: world.core, env: { COPILOT_ASSIGN_TOKEN: "pat", ...env } });
    } finally {
        globalThis.fetch = original;
    }
}

const pipelinePr = (overrides = {}) => ({
    id: 9020,
    number: 20,
    node_id: "PR_20",
    state: "open",
    draft: false,
    merged: false,
    auto_merge: null,
    title: "Docs fix",
    body: "## Linked issue\n\nCloses #10\n\n## Follow-ups\n\nNone\n\n<!-- auto-generated-pr-description:start -->\nFixes #99\n<!-- auto-generated-pr-description:end -->\nFixes #10",
    user: { login: "Copilot", type: "Bot" },
    head: { sha: SHA, ref: "copilot/docs-fix", repo: { full_name: REPO } },
    base: { ref: "main" },
    ...overrides,
});

const boundComment = (pr = 20, login = PAT_LOGIN) => ({ user: { login, type: "User" }, body: `Spec approved.\n\n${gateMarker("bound", pr)}` });
const qaComment = (verdict = "pass", runId = 202, user = BOT) => ({ user, body: `<!-- factory-qa:${verdict} -->\n## Factory QA: ${verdict}\n\nHead: ${SHA}\nRun: ${runId}\n\n- npm run check: ${verdict}` });
const reviewRun = { id: 101, path: ".github/workflows/factory-review.lock.yml", event: "pull_request", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", run_started_at: "2026-01-01T00:00:10Z" };
const qaRun = { id: 202, path: ".github/workflows/factory-qa.lock.yml", event: "pull_request", status: "completed", conclusion: "success", created_at: "2026-01-01T00:00:00Z", run_started_at: "2026-01-01T00:00:10Z" };
const factoryApproval = { user: BOT, commit_id: SHA, state: "APPROVED", body: "Approve. [nit] wording", submitted_at: "2026-01-01T00:05:00Z" };
const copilotReview = { user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" }, commit_id: SHA, state: "COMMENTED", submitted_at: "2026-01-01T00:03:00Z" };

function reviewWorld(overrides = {}) {
    return fakeGitHub({
        issues: [{ number: 10, labels: overrides.labels ?? ["agent:active", "status:review", "type:docs", "role:docs"] }],
        prs: [pipelinePr(overrides.pr)],
        comments: { 10: overrides.issueComments ?? [boundComment()], 20: overrides.prComments ?? [qaComment()] },
        reviews: overrides.reviews ?? [copilotReview, factoryApproval],
        runs: { "factory-review.lock.yml": overrides.reviewRuns ?? [reviewRun], "factory-qa.lock.yml": overrides.qaRuns ?? [qaRun] },
        checkRuns: overrides.checkRuns ?? [{ id: 1, name: "Validate (Node 22.18.0)", status: "completed", conclusion: "success" }],
        files: overrides.files ?? [{ filename: "SPEC/issue-10-docs.md", status: "added" }, { filename: "docs/notes.md", status: "modified" }],
        commits: overrides.commits,
        fileContent: "## Delegation\n- docs-writer: Update docs\n- QA depth: fast\n",
        graphqlErrors: overrides.graphqlErrors,
        tasks: overrides.tasks,
        tasksError: overrides.tasksError,
    });
}

const workflowRun = (head_sha = SHA) => ({ workflow_run: { event: "pull_request", head_sha, pull_requests: [{ number: 20 }] } });
// One old (spec) session, then the latest session created after the default hand-off at 01:00.
const copilotTask = (sessionState, artifacts = [{ type: "pull", data: { id: 9020 } }], id = "task-1", latestAt = "2026-01-01T02:00:00Z") => ({
    id,
    state: sessionState,
    artifacts,
    sessions: [
        { state: "completed", created_at: "2026-01-01T00:30:00Z" },
        { state: sessionState, error: null, created_at: latestAt },
    ],
});
const handoff = (kind, created_at = "2026-01-01T01:00:00Z", login = PAT_LOGIN) => ({ user: { login, type: "User" }, created_at, body: `@copilot ...\n\n${gateMarker(kind, SHA)}` });

test("evaluate: all gates green on a docs PR enables auto-merge bound to the head SHA", async () => {
    const world = reviewWorld();
    await run(world, handleWorkflowRun, workflowRun());
    assert.deepEqual(world.pat.filter(([kind]) => kind === "graphql"), [["graphql", "enablePullRequestAutoMerge", { id: "PR_20", sha: SHA }]]);
    assert.match(world.writes.at(-1)[2], /auto-merge enabled for this head only/);
    assert.ok(!world.labelsOf(10).includes("agent:needs-human"));
});

test("evaluate: no auto-merge while a Copilot session is active", async () => {
    const world = reviewWorld({ tasks: [copilotTask("in_progress")] });
    await run(world, handleWorkflowRun, workflowRun());
    assert.deepEqual([world.writes, world.pat], [[], []]);
    assert.match(world.logs.at(-1), /not enabling auto-merge yet/);
});

test("evaluate: a PR that is already clean merges directly with the reviewed SHA", async () => {
    const world = reviewWorld({ graphqlErrors: { enablePullRequestAutoMerge: "Pull request is in clean status" } });
    await run(world, handleWorkflowRun, workflowRun());
    assert.deepEqual(world.pat.find(([method]) => method === "PUT"), ["PUT", "/repos/drdave-slalom/pacman-256/pulls/20/merge", { merge_method: "squash", sha: SHA }]);
});

test("evaluate: a stale SHA, running workflows, or pending checks only wait", async () => {
    const stale = reviewWorld();
    await run(stale, handleWorkflowRun, workflowRun("feedface"));
    assert.deepEqual([stale.writes, stale.pat], [[], []]);

    const running = reviewWorld({ qaRuns: [{ ...qaRun, status: "in_progress", conclusion: null }] });
    await run(running, handleWorkflowRun, workflowRun());
    assert.deepEqual([running.writes, running.pat], [[], []]);

    const pending = reviewWorld({ checkRuns: [] });
    await run(pending, handleWorkflowRun, workflowRun());
    assert.deepEqual([pending.writes, pending.pat], [[], []]);
    assert.match(pending.logs.at(-1), /Waiting for required checks/);

    const noCopilot = reviewWorld({ reviews: [factoryApproval] });
    await run(noCopilot, handleWorkflowRun, workflowRun());
    assert.deepEqual([noCopilot.writes, noCopilot.pat], [[], []]);
});

test("evaluate: blockers start a cycle, return the PR to draft and [WIP], and post one fix request", async () => {
    const reviews = [copilotReview, { ...factoryApproval, state: "CHANGES_REQUESTED", body: "- [blocker] crash when @mallory joins\n- [nit] wording" }];
    const world = reviewWorld({ reviews, prComments: [qaComment("fail")] });
    await run(world, handleWorkflowRun, workflowRun());
    assert.deepEqual(world.pat[0], ["graphql", "convertPullRequestToDraft", { id: "PR_20" }]);
    assert.ok(world.writes.some(([kind, , title]) => kind === "setTitle" && title === "[WIP] Docs fix"));
    const labels = world.labelsOf(10);
    assert.ok(labels.includes("cycle:1") && labels.includes("status:ready") && !labels.includes("status:review"));
    const [, path, body] = world.pat[1];
    assert.equal(path, "/repos/drdave-slalom/pacman-256/issues/20/comments");
    assert.match(body.body, /^@copilot /);
    assert.match(body.body, /\[blocker\] crash when @\u200bmallory joins/);
    assert.match(body.body, /Factory QA \(fail\)/);
    assert.match(body.body, /`docs-writer`/);
    assert.ok(body.body.includes(gateMarker("fix", SHA)));
    assert.ok(!body.body.includes("[nit]"));

    // A trusted fix marker for this SHA while Copilot is still working only waits.
    const fixMarker = { user: { login: PAT_LOGIN }, body: gateMarker("fix", SHA) };
    const again = reviewWorld({ reviews, prComments: [qaComment("fail"), fixMarker], tasks: [copilotTask("in_progress")] });
    await run(again, handleWorkflowRun, workflowRun());
    assert.deepEqual([again.writes, again.pat], [[], []]);
    assert.match(again.logs.at(-1), /still working; waiting/);

    // A marker from anyone else is ignored.
    const spoofed = reviewWorld({ reviews, prComments: [qaComment("fail"), { user: { login: "mallory" }, body: gateMarker("fix", SHA) }] });
    await run(spoofed, handleWorkflowRun, workflowRun());
    assert.equal(spoofed.pat.length, 2);
});

test("evaluate: blockers repeated on a head whose fix session ended without commits stop at needs-human", async () => {
    const reviews = [copilotReview, { ...factoryApproval, state: "CHANGES_REQUESTED", body: "- [blocker] AGENTS.md:38 unchanged" }];
    const fixMarker = { user: { login: PAT_LOGIN }, body: gateMarker("fix", SHA) };
    for (const [name, overrides] of Object.entries({ done: { tasks: [copilotTask("completed")] }, "API error": { tasksError: 500 } })) {
        const world = reviewWorld({ labels: ["agent:active", "status:review", "type:docs", "cycle:1"], reviews, prComments: [qaComment(), fixMarker], ...overrides });
        await run(world, handleWorkflowRun, workflowRun());
        assert.deepEqual(world.pat, [], name);
        assert.ok(world.labelsOf(10).includes("agent:needs-human"), name);
        assert.ok(!world.labelsOf(10).includes("cycle:2"), name);
        const message = world.writes.at(-1)[2];
        assert.equal(world.writes.at(-1)[1], 20, name);
        assert.match(message, /raised again on `0123456`/, name);
        assert.match(message, /false positive/, name);
        assert.match(message, /AGENTS\.md:38 unchanged/, name);
        assert.match(message, /dismiss the factory review, remove `agent:needs-human`, then re-run the Factory Review run.*gh run rerun <id>/, name);
    }
});

test("evaluate: second cycle adds cycle:2; blockers after cycle:2 stop at needs-human", async () => {
    const second = reviewWorld({ labels: ["agent:active", "status:review", "type:docs", "cycle:1"], prComments: [qaComment("fail")] });
    await run(second, handleWorkflowRun, workflowRun());
    assert.ok(second.labelsOf(10).includes("cycle:2"));

    const exhausted = reviewWorld({ labels: ["agent:active", "status:review", "type:docs", "cycle:1", "cycle:2"], prComments: [qaComment("fail")] });
    await run(exhausted, handleWorkflowRun, workflowRun());
    assert.deepEqual(exhausted.pat, []);
    assert.ok(exhausted.labelsOf(10).includes("agent:needs-human"));
    assert.match(exhausted.writes.at(-1)[2], /D050 review\/fix cap/);
});

test("evaluate: failing required checks are blockers", async () => {
    const world = reviewWorld({ checkRuns: [{ id: 1, name: "Validate (Node 22.18.0)", status: "completed", conclusion: "failure" }] });
    await run(world, handleWorkflowRun, workflowRun());
    assert.match(world.pat[1][2].body, /Required checks failing/);
});

test("evaluate: spoofed or unbound verdicts are not trusted", async () => {
    const cases = {
        "QA by another user": { prComments: [qaComment("pass", 202, { login: "mallory", type: "User" })] },
        "QA for an older run": { prComments: [qaComment("pass", 199)] },
        "review before the run started": { reviews: [copilotReview, { ...factoryApproval, submitted_at: "2026-01-01T00:00:01Z" }] },
        "review run failed": { reviewRuns: [{ ...reviewRun, conclusion: "failure" }] },
        "review by another user": { reviews: [copilotReview, { ...factoryApproval, user: { login: "mallory" } }] },
    };
    for (const [name, overrides] of Object.entries(cases)) {
        const world = reviewWorld(overrides);
        await run(world, handleWorkflowRun, workflowRun());
        assert.deepEqual(world.pat.filter(([kind]) => kind === "graphql"), [], name);
        assert.ok(world.labelsOf(10).includes("agent:needs-human"), name);
        assert.match(world.writes.at(-1)[2], /without/, name);
    }
});

test("evaluate: an unbound PR, or a bound marker from another user, stops at needs-human", async () => {
    for (const issueComments of [[], [boundComment(20, "mallory")], [boundComment(21)]]) {
        const world = reviewWorld({ issueComments });
        await run(world, handleWorkflowRun, workflowRun());
        assert.ok(world.labelsOf(10).includes("agent:needs-human"));
        assert.match(world.writes.at(-1)[2], /not bound/);
        assert.deepEqual(world.pat.filter(([kind]) => kind === "graphql"), []);
    }
});

test("evaluate: sensitive files in any commit or human-merge types need a human merge", async () => {
    const sensitive = reviewWorld({
        files: [{ filename: "docs/notes.md" }],
        commits: [
            { sha: "c1", files: [{ filename: ".github/workflows/ci.yml" }] },
            { sha: "c2", files: [{ filename: "docs/notes.md" }] },
        ],
    });
    await run(sensitive, handleWorkflowRun, workflowRun());
    assert.deepEqual(sensitive.pat.filter(([kind]) => kind === "graphql"), []);
    assert.ok(sensitive.labelsOf(10).includes("agent:needs-human"));
    assert.ok(sensitive.writes.some(([kind, number, reviewers]) => kind === "requestReviewers" && number === 20 && reviewers[0] === "drdave-slalom"));
    assert.match(sensitive.writes.at(-1)[2], /sensitive paths \(`\.github\/workflows\/ci\.yml`\)/);

    const feature = reviewWorld({ labels: ["agent:active", "status:review", "type:feature"] });
    await run(feature, handleManualEvaluate, {}, { PR_NUMBER: "20", AGENT_MERGE_REVIEWER: "teammate" });
    assert.deepEqual(feature.pat.filter(([kind]) => kind === "graphql"), []);
    assert.ok(feature.labelsOf(10).includes("agent:needs-human"));
    assert.ok(feature.writes.some(([kind, , reviewers]) => kind === "requestReviewers" && reviewers[0] === "teammate"));
    assert.match(feature.writes.at(-1)[2], /not a low-risk type/);
});

test("pipeline PRs require the Copilot bot, a same-repo branch, and exactly one active linked issue", async () => {
    for (const pr of [{ user: { login: "Copilot", type: "User" } }, { head: { sha: SHA, repo: { full_name: "fork/pacman-256" } } }, { user: { login: "drdave-slalom", type: "User" } }]) {
        const world = reviewWorld({ pr });
        await run(world, handleWorkflowRun, workflowRun());
        assert.deepEqual([world.writes, world.pat], [[], []]);
    }
    const world = fakeGitHub({
        issues: [
            { number: 10, labels: ["agent:active", "status:review"] },
            { number: 11, labels: ["agent:active", "status:review"] },
        ],
        prs: [pipelinePr({ body: "Closes #10\nCloses #11" })],
    });
    await run(world, handleWorkflowRun, workflowRun());
    assert.ok(world.labelsOf(10).includes("agent:needs-human") && world.labelsOf(11).includes("agent:needs-human"));
    assert.match(world.writes.at(-1)[2], /exactly one/);
    const writes = world.writes.length;
    await run(world, handleWorkflowRun, workflowRun());
    assert.equal(world.writes.length, writes, "no repeat comment once both issues are flagged");
});

test("pull request events: synchronize disables auto-merge; a finished build is marked ready", async () => {
    const sync = reviewWorld({ pr: { auto_merge: { merge_method: "squash" } } });
    await run(sync, handlePullRequestEvent, { action: "synchronize", pull_request: { number: 20 } });
    assert.deepEqual(sync.pat, [["graphql", "disablePullRequestAutoMerge", { id: "PR_20" }]]);
    assert.match(sync.writes.at(-1)[2], /auto-merge disabled/);

    const syncNeedsHuman = reviewWorld({ pr: { auto_merge: {} }, labels: ["agent:active", "agent:needs-human"] });
    await run(syncNeedsHuman, handlePullRequestEvent, { action: "synchronize", pull_request: { number: 20 } });
    assert.deepEqual(syncNeedsHuman.pat, [["graphql", "disablePullRequestAutoMerge", { id: "PR_20" }]]);

    // During a build, a draft without [WIP] is not finished by synchronize or edited events.
    for (const action of ["synchronize", "edited"]) {
        const draft = reviewWorld({ pr: { draft: true }, labels: ["agent:active", "status:ready", "type:docs"] });
        await run(draft, handlePullRequestEvent, { action, pull_request: { number: 20 } });
        assert.deepEqual([draft.writes, draft.pat], [[], []], action);
        assert.ok(draft.labelsOf(10).includes("status:ready"), action);
    }

    // An explicit "Ready for review" moves the issue to review without another mutation.
    const ready = reviewWorld({ labels: ["agent:active", "status:ready", "type:docs"] });
    await run(ready, handlePullRequestEvent, { action: "ready_for_review", pull_request: { number: 20 } });
    assert.deepEqual(ready.pat, []);
    assert.ok(ready.labelsOf(10).includes("status:review") && !ready.labelsOf(10).includes("status:ready"));

    const wip = reviewWorld({ pr: { draft: true, title: "[WIP] Docs fix" }, labels: ["agent:active", "status:ready"] });
    await run(wip, handlePullRequestEvent, { action: "edited", pull_request: { number: 20 } });
    assert.deepEqual([wip.writes, wip.pat], [[], []]);

    const unbound = reviewWorld({ labels: ["agent:active", "status:ready"], issueComments: [] });
    await run(unbound, handlePullRequestEvent, { action: "ready_for_review", pull_request: { number: 20 } });
    assert.deepEqual(unbound.pat, []);
    assert.ok(unbound.labelsOf(10).includes("agent:needs-human"));
});

test("close-out: merged clears pipeline labels and files mention-safe follow-ups; unmerged stops", async () => {
    const body = "Closes #10\n\n## Follow ups\n\n- Rename helper for @mallory\n- _None_\n- Add test";
    const merged = fakeGitHub({
        issues: [{ number: 10, labels: ["agent:active", "status:review", "cycle:1", "cycle:2", "agent:needs-human", "type:docs", "role:docs"] }],
        prs: [pipelinePr({ state: "closed", merged: true, body })],
    });
    await run(merged, handlePullRequestEvent, { action: "closed", pull_request: { number: 20 } });
    assert.deepEqual(merged.labelsOf(10), ["type:docs", "role:docs"]);
    const created = merged.writes.filter(([kind]) => kind === "createIssue").map(([, , issue]) => issue);
    assert.equal(created.length, 2);
    assert.equal(created[0].title, "Follow-up from #20: Rename helper for @\u200bmallory");
    assert.deepEqual(created[0].labels, ["follow-up"]);
    assert.match(created[0].body, /> Rename helper for @\u200bmallory/);
    assert.match(merged.writes.at(-1)[2], /Follow-ups filed: #500, #501/);

    const unmerged = fakeGitHub({
        issues: [{ number: 10, labels: ["agent:active", "status:review", "cycle:1", "role:docs", "role:qa", "type:docs"] }],
        prs: [pipelinePr({ state: "closed", merged: false })],
    });
    await run(unmerged, handlePullRequestEvent, { action: "closed", pull_request: { number: 20 } });
    assert.deepEqual(unmerged.labelsOf(10), ["type:docs", "agent:needs-human"]);
    assert.equal(unmerged.writes.filter(([kind]) => kind === "createIssue").length, 0);
});

const dispatchIssue = (labels = ["agent:go"], extra = {}) => ({ number: 5, title: "Fix README typo", labels, ...extra });
const dispatchPayload = (sender = { login: PAT_LOGIN, type: "User" }) => ({ label: { name: "agent:go" }, issue: { number: 5 }, sender, repository: { default_branch: "main" } });

test("dispatch assigns the orchestrator with model auto after clearing earlier run labels", async () => {
    const world = fakeGitHub({ issues: [dispatchIssue(["agent:go", "cycle:1", "cycle:2", "status:review", "status:ready", "role:builder", "role:qa", "type:docs"])] });
    await run(world, handleDispatch, dispatchPayload());
    const [method, path, body] = world.pat[0];
    assert.equal(method, "POST");
    assert.equal(path, "/repos/drdave-slalom/pacman-256/issues/5/assignees");
    assert.deepEqual(body.assignees, ["copilot-swe-agent[bot]"]);
    assert.equal(body.agent_assignment.custom_agent, "factory-orchestrator");
    assert.equal(body.agent_assignment.model, "auto");
    assert.equal(body.agent_assignment.target_repo, REPO);
    assert.equal(body.agent_assignment.base_branch, "main");
    assert.match(body.agent_assignment.custom_instructions, /SPEC\/issue-5-fix-readme-typo\.md/);
    const removedBeforeAssign = world.writes.filter(([kind]) => kind === "removeLabel").map(([, , name]) => name);
    assert.deepEqual(removedBeforeAssign.sort(), ["agent:go", "cycle:1", "cycle:2", "role:builder", "role:qa", "status:ready", "status:review"]);
    assert.deepEqual(world.labelsOf(5).sort(), ["agent:active", "status:spec", "type:docs"]);
});

test("dispatch ignores bots, non-collaborators, and readers; respects needs-human, assignment, and the limit", async () => {
    for (const sender of [{ login: "github-actions[bot]", type: "Bot" }, { login: "Copilot", type: "User" }, { login: "stranger", type: "User" }, { login: "reader", type: "User" }]) {
        const world = fakeGitHub({ issues: [dispatchIssue()], roles: { reader: "read" } });
        await run(world, handleDispatch, dispatchPayload(sender));
        assert.deepEqual([world.writes, world.pat], [[], []], sender.login);
    }
    const triage = fakeGitHub({ issues: [dispatchIssue()] });
    await run(triage, handleDispatch, dispatchPayload({ login: "helper", type: "User" }));
    assert.equal(triage.pat.length, 1);

    const needsHuman = fakeGitHub({ issues: [dispatchIssue(["agent:go", "agent:needs-human"])] });
    await run(needsHuman, handleDispatch, dispatchPayload());
    assert.deepEqual([needsHuman.pat, needsHuman.writes.map(([kind]) => kind)], [[], ["comment"]]);

    const assigned = fakeGitHub({ issues: [dispatchIssue(["agent:go"], { assignees: [{ login: "Copilot" }] })] });
    await run(assigned, handleDispatch, dispatchPayload());
    assert.deepEqual([assigned.writes, assigned.pat], [[], []]);

    const full = fakeGitHub({ issues: [dispatchIssue()], activeIssues: [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4, pull_request: {} }] });
    await run(full, handleDispatch, dispatchPayload());
    assert.deepEqual(full.pat, []);
    assert.equal(full.writes.length, 1);
    assert.match(full.writes[0][2], /limit 3/);
});

function approveWorld({
    title = "Spec: docs fix",
    body,
    fileContent = "## Delegation\n- docs-writer: Update README\n- builder: Add a test\n- QA depth: slow\n",
    labels = ["agent:active", "status:spec", "role:art", "type:docs"],
    tasks,
    tasksError,
    updateBodyError,
} = {}) {
    return fakeGitHub({
        issues: [{ number: 10, labels }],
        prs: [pipelinePr({ draft: true, title, ...(body === undefined ? {} : { body }) })],
        files: [{ filename: "SPEC/issue-10-docs-fix.md", status: "added" }],
        fileContent,
        tasks,
        tasksError,
        updateBodyError,
    });
}
const approvePayload = (body = "/approve-spec", user = { login: PAT_LOGIN, type: "User" }) => ({ issue: { number: 20, pull_request: {} }, comment: { body, user } });

test("/approve-spec binds the issue, mirrors roles, re-marks [WIP], and posts build instructions", async () => {
    const world = approveWorld();
    await run(world, handleApproveSpec, approvePayload(`/approve-spec ${SHA.slice(0, 10)}`));
    assert.ok(world.writes.some(([kind, number, title]) => kind === "setTitle" && number === 20 && title === "[WIP] Spec: docs fix"));
    assert.deepEqual(world.labelsOf(10).sort(), ["agent:active", "role:builder", "role:docs", "status:ready", "type:docs"]);
    const [bind, build] = world.pat;
    assert.equal(bind[1], "/repos/drdave-slalom/pacman-256/issues/10/comments");
    assert.ok(bind[2].body.includes(gateMarker("bound", 20)));
    assert.equal(build[1], "/repos/drdave-slalom/pacman-256/issues/20/comments");
    assert.match(build[2].body, /^@copilot /);
    assert.match(build[2].body, /1\. \*\*docs-writer\*\*: Update README/);
    assert.match(build[2].body, /2\. \*\*builder\*\*: Add a test/);
    assert.match(build[2].body, /QA depth: slow/);
    assert.ok(!world.writes.some(([kind]) => kind === "setBody"), "Linked issue already closes #10");
});

test("/approve-spec: a Copilot session in progress refuses; a finished session strips [WIP] and proceeds", async () => {
    for (const state of ["in_progress", "queued"]) {
        const busy = approveWorld({ title: "Spec: docs fix", tasks: [copilotTask(state)] });
        await run(busy, handleApproveSpec, approvePayload());
        assert.deepEqual(busy.pat, [], state);
        assert.match(busy.writes.at(-1)[2], /Copilot is still working/, state);
        assert.ok(busy.labelsOf(10).includes("status:spec"), state);
        assert.deepEqual(busy.agentReads, ["/agents/repos/drdave-slalom/pacman-256/tasks", "/agents/repos/drdave-slalom/pacman-256/tasks/task-1"]);
    }

    const done = approveWorld({ title: "[WIP] Spec: docs fix", tasks: [copilotTask("completed", [{ type: "branch", data: { head_ref: "copilot/docs-fix" } }])] });
    await run(done, handleApproveSpec, approvePayload());
    const titles = done.writes.filter(([kind]) => kind === "setTitle").map(([, , title]) => title);
    assert.deepEqual(titles, ["Spec: docs fix", "[WIP] Spec: docs fix"]);
    assert.ok(done.labelsOf(10).includes("status:ready"));
    assert.equal(done.pat.length, 2);

    // Tasks for other PRs or branches do not count.
    const other = approveWorld({ title: "[WIP] Spec: docs fix", tasks: [copilotTask("completed", [{ type: "pull", data: { id: 1 } }, { type: "branch", data: { head_ref: "copilot/other" } }])] });
    await run(other, handleApproveSpec, approvePayload());
    assert.deepEqual(other.pat, []);
    assert.match(other.writes.at(-1)[2], /could not be confirmed/);
});

test("/approve-spec fills `Closes #<issue>` under Linked issue only when it is missing", async () => {
    const placeholder = "## Linked issue\n\n<!-- `Closes #<n>`, or \"No issue\" if none. -->\nCloses #\n\n## Spec\n\nSPEC/x.md\n\n<!-- auto-generated-pr-description:start -->\nFixes #10\n<!-- auto-generated-pr-description:end -->\nFixes #10";
    const world = approveWorld({ body: placeholder });
    await run(world, handleApproveSpec, approvePayload());
    const [, number, body] = world.writes.find(([kind]) => kind === "setBody");
    assert.equal(number, 20);
    assert.equal(body, placeholder.replace("Closes #\n", "Closes #10\n"));
    assert.equal(world.pat.length, 2);

    // A failed body update is only a warning.
    const failing = approveWorld({ body: placeholder, updateBodyError: "Forbidden" });
    await run(failing, handleApproveSpec, approvePayload());
    assert.equal(failing.pat.length, 2);
    assert.ok(failing.logs.some((line) => /Could not fill "Linked issue"/.test(line)));
});

test("Linked issue filling: placeholder, missing line, missing section, already present", () => {
    assert.equal(fillLinkedIssue("## Linked issue\n\nCloses #10\n\n## Spec", 10), null);
    assert.equal(fillLinkedIssue("## Linked issue\nFixes #10", 10), null);
    assert.equal(fillLinkedIssue("## Linked issue\n\n## Spec\nx", 10), "## Linked issue\n\nCloses #10\n\n## Spec\nx");
    assert.equal(fillLinkedIssue("## Linked issue\nCloses #\n## Spec", 10), "## Linked issue\nCloses #10\n## Spec");
    assert.equal(fillLinkedIssue("## Linked issue\nCloses #7\n## Spec", 10), "## Linked issue\n\nCloses #10\nCloses #7\n## Spec");
    assert.equal(fillLinkedIssue("Summary\n\nFixes #10", 10), "## Linked issue\n\nCloses #10\n\nSummary\n\nFixes #10");
    assert.equal(
        fillLinkedIssue("<!-- auto-generated-pr-description:start -->\n## Linked issue\nCloses #10\n<!-- auto-generated-pr-description:end -->\n## Linked issue\nCloses #\n", 10),
        "<!-- auto-generated-pr-description:start -->\n## Linked issue\nCloses #10\n<!-- auto-generated-pr-description:end -->\n## Linked issue\nCloses #10\n",
    );
});

test("Copilot activity: matching by PR id or branch; working, done, and unknown", () => {
    const pr = { id: 9020, head: { ref: "copilot/docs-fix" } };
    assert.equal(taskMatchesPr({ artifacts: [{ type: "pull", data: { id: 9020 } }] }, pr), true);
    assert.equal(taskMatchesPr({ artifacts: [{ type: "branch", data: { head_ref: "copilot/docs-fix" } }] }, pr), true);
    assert.equal(taskMatchesPr({ artifacts: [{ type: "pull", data: { id: 1 } }, { type: "branch", data: { head_ref: "main" } }] }, pr), false);
    assert.equal(taskMatchesPr({}, pr), false);
    assert.equal(copilotActivity([]).state, "unknown");
    assert.equal(copilotActivity([copilotTask("in_progress")]).state, "working");
    assert.equal(copilotActivity([copilotTask("queued")]).state, "working");
    assert.equal(copilotActivity([copilotTask("completed"), copilotTask("failed")]).state, "done");
    assert.equal(copilotActivity([{ id: "t", state: "queued", sessions: [] }]).state, "working");
    assert.equal(copilotActivity([{ id: "t", state: "completed", sessions: [] }]).state, "unknown");
    assert.equal(copilotActivity([{ id: "t", sessions: [{ state: "completed" }, { state: "waiting_for_user" }] }]).state, "unknown");
    for (const ended of ["completed", "failed", "cancelled", "canceled", "timed_out"]) {
        assert.equal(copilotActivity([{ id: "t", sessions: [{ state: ended, created_at: "2026-01-01T02:00:00Z" }] }], { since: "2026-01-01T01:00:00Z" }).state, "done", ended);
    }
    assert.equal(copilotActivity([copilotTask("completed", undefined, "t", "2026-01-01T00:40:00Z")], { since: "2026-01-01T01:00:00Z" }).state, "pending");
    assert.equal(stripWipTitle("[WIP] [wip]  Docs fix"), "Docs fix");
    assert.equal(stripWipTitle("Docs fix [WIP]"), "Docs fix [WIP]");
    assert.equal(isCopilotBotUser({ login: "Copilot", type: "Bot" }), true);
    assert.equal(isCopilotBotUser({ login: "copilot-swe-agent[bot]", type: "Bot" }), true);
    assert.equal(isCopilotBotUser({ login: "Copilot", type: "User" }), false);
    assert.equal(isCopilotBotUser({ login: "github-actions[bot]", type: "Bot" }), false);
});

const copilotCommentPayload = (user = { login: "Copilot", type: "Bot" }, action = "created") => ({ action, issue: { number: 20, pull_request: {} }, comment: { body: "Done: updated docs; npm run check passed.", user } });
const buildWorld = (overrides = {}) =>
    reviewWorld({ pr: { draft: true, title: "[WIP] Docs fix", ...overrides.pr }, labels: overrides.labels ?? ["agent:active", "status:ready", "type:docs", "role:docs"], ...overrides, prComments: overrides.prComments ?? [handoff("build")] });

test("completion: only a session started after the latest build or fix hand-off finishes it", async () => {
    for (const kind of ["build", "fix"]) {
        // The earlier (spec or build) session ended before the hand-off: not finished.
        const stale = buildWorld({ prComments: [handoff(kind)], tasks: [copilotTask("completed", undefined, "task-1", "2026-01-01T00:40:00Z")] });
        await run(stale, handleCopilotComment, copilotCommentPayload());
        assert.deepEqual([stale.writes, stale.pat], [[], []], kind);
        assert.match(stale.logs.at(-1), /is pending/, kind);

        // A session created after the hand-off has completed: finished.
        const fresh = buildWorld({ prComments: [handoff(kind)], tasks: [copilotTask("completed")] });
        await run(fresh, handleCopilotComment, copilotCommentPayload());
        assert.deepEqual(fresh.pat, [["graphql", "markPullRequestReadyForReview", { id: "PR_20" }]], kind);
        assert.ok(fresh.labelsOf(10).includes("status:review"), kind);
    }

    // The latest hand-off wins: a session after the build but before a later fix request does not count.
    const refixed = buildWorld({ prComments: [handoff("build"), handoff("fix", "2026-01-01T03:00:00Z")], tasks: [copilotTask("completed")] });
    await run(refixed, handleCopilotComment, copilotCommentPayload());
    assert.deepEqual([refixed.writes, refixed.pat], [[], []]);

    // Hand-off markers from anyone but the PAT user, or none at all, are ignored.
    for (const prComments of [[], [handoff("build", undefined, "mallory")]]) {
        const world = buildWorld({ prComments, tasks: [copilotTask("completed")] });
        await run(world, handleCopilotComment, copilotCommentPayload());
        assert.deepEqual([world.writes, world.pat, world.agentReads], [[], [], []]);
        assert.match(world.logs.at(-1), /no build or fix hand-off/);
    }

    // An unrecognised session state is unknown.
    const odd = buildWorld({ tasks: [{ ...copilotTask("completed"), sessions: [{ state: "waiting_for_user", created_at: "2026-01-01T02:00:00Z" }] }] });
    await run(odd, handleCopilotComment, copilotCommentPayload());
    assert.deepEqual([odd.writes, odd.pat], [[], []]);
    assert.match(odd.logs.at(-1), /is unknown/);
});

test("completion: a Copilot reply after the session ended strips [WIP] and marks the build ready", async () => {
    const world = buildWorld({ tasks: [copilotTask("completed")] });
    const sleeps = [];
    const original = globalThis.fetch;
    globalThis.fetch = world.fetchImpl;
    try {
        await handleCopilotComment({ github: world.github, context: { repo: { owner: "drdave-slalom", repo: "pacman-256" }, payload: copilotCommentPayload() }, core: world.core, env: { COPILOT_ASSIGN_TOKEN: "pat" }, sleep: async (ms) => sleeps.push(ms) });
    } finally {
        globalThis.fetch = original;
    }
    assert.deepEqual(sleeps, []);
    assert.ok(world.writes.some(([kind, number, title]) => kind === "setTitle" && number === 20 && title === "Docs fix"));
    assert.deepEqual(world.pat, [["graphql", "markPullRequestReadyForReview", { id: "PR_20" }]]);
    assert.ok(world.labelsOf(10).includes("status:review") && !world.labelsOf(10).includes("status:ready"));

    // At the spec gate only the title is cleaned up.
    const spec = buildWorld({ labels: ["agent:active", "status:spec"], tasks: [copilotTask("completed")] });
    await run(spec, handleCopilotComment, copilotCommentPayload());
    assert.deepEqual(spec.writes, [["setTitle", 20, "Docs fix"]]);
    assert.deepEqual(spec.pat, []);
});

test("completion: in progress (after retries), API errors, and other commenters do nothing", async () => {
    const busy = buildWorld({ tasks: [copilotTask("in_progress")] });
    const sleeps = [];
    const original = globalThis.fetch;
    globalThis.fetch = busy.fetchImpl;
    try {
        await handleCopilotComment({ github: busy.github, context: { repo: { owner: "drdave-slalom", repo: "pacman-256" }, payload: copilotCommentPayload() }, core: busy.core, env: { COPILOT_ASSIGN_TOKEN: "pat" }, sleep: async (ms) => sleeps.push(ms) });
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(sleeps.length, 3);
    assert.deepEqual([busy.writes, busy.pat], [[], []]);
    assert.match(busy.logs.at(-1), /is working/);

    for (const [name, overrides] of Object.entries({ "API error": { tasksError: 502 }, "no linked task": { tasks: [copilotTask("completed", [{ type: "pull", data: { id: 1 } }])] } })) {
        const world = buildWorld(overrides);
        await run(world, handleCopilotComment, copilotCommentPayload());
        assert.deepEqual([world.writes, world.pat], [[], []], name);
        assert.match(world.logs.at(-1), /is unknown/, name);
    }
    const errored = buildWorld({ tasksError: 502 });
    await run(errored, handleCopilotComment, copilotCommentPayload());
    assert.ok(errored.logs.some((line) => /Could not read Copilot task state.*502/.test(line)));

    for (const payload of [copilotCommentPayload({ login: "drdave-slalom", type: "User" }), copilotCommentPayload({ login: "Copilot", type: "User" }), copilotCommentPayload(undefined, "edited")]) {
        const world = buildWorld({ tasks: [copilotTask("completed")] });
        await run(world, handleCopilotComment, payload);
        assert.deepEqual([world.writes, world.pat, world.agentReads], [[], [], []]);
    }

    const stopped = buildWorld({ labels: ["agent:active", "status:ready", "agent:needs-human"], tasks: [copilotTask("completed")] });
    await run(stopped, handleCopilotComment, copilotCommentPayload());
    assert.deepEqual([stopped.writes, stopped.pat], [[], []]);
});

test("completion: manual evaluate finishes a completed build before evaluating gates", async () => {
    const world = buildWorld({ tasks: [copilotTask("completed")] });
    await run(world, handleManualEvaluate, {}, { PR_NUMBER: "20" });
    assert.ok(world.writes.some(([kind, , title]) => kind === "setTitle" && title === "Docs fix"));
    assert.deepEqual(world.pat, [["graphql", "markPullRequestReadyForReview", { id: "PR_20" }]]);
    assert.ok(world.labelsOf(10).includes("status:review"));

    const busy = buildWorld({ tasks: [copilotTask("queued")] });
    await run(busy, handleManualEvaluate, {}, { PR_NUMBER: "20" });
    assert.deepEqual([busy.writes, busy.pat], [[], []]);
});

test("/approve-spec refuses while [WIP] when the tasks API is unavailable, on a SHA mismatch, and ignores bots and non-writers", async () => {
    for (const overrides of [{}, { tasksError: 403 }]) {
        const wip = approveWorld({ title: "[WIP] Spec: docs fix", ...overrides });
        await run(wip, handleApproveSpec, approvePayload());
        assert.deepEqual(wip.pat, []);
        assert.match(wip.writes.at(-1)[2], /could not be confirmed/);
        assert.match(wip.writes.at(-1)[2], /remove the `\[WIP\]` prefix yourself and comment `\/approve-spec` again/);
        assert.ok(wip.labelsOf(10).includes("status:spec"));
    }

    // No [WIP] and no task information: approve as before.
    const unknownClean = approveWorld({ tasksError: 500 });
    await run(unknownClean, handleApproveSpec, approvePayload());
    assert.equal(unknownClean.pat.length, 2);

    const mismatch = approveWorld();
    await run(mismatch, handleApproveSpec, approvePayload("/approve-spec abcdef0"));
    assert.deepEqual(mismatch.pat, []);
    assert.match(mismatch.writes.at(-1)[2], /does not match the PR head/);

    for (const user of [{ login: "github-actions[bot]", type: "Bot" }, { login: "Copilot", type: "User" }, { login: "helper", type: "User" }, { login: "stranger", type: "User" }]) {
        const world = approveWorld();
        await run(world, handleApproveSpec, approvePayload("/approve-spec", user));
        assert.deepEqual([world.writes, world.pat], [[], []], user.login);
    }
});

test("/approve-spec stops at needs-human for an unknown delegation profile", async () => {
    const world = approveWorld({ fileContent: "## Delegation\n- qa-tester: run everything\n- QA depth: fast\n" });
    await run(world, handleApproveSpec, approvePayload());
    assert.deepEqual(world.pat, []);
    assert.deepEqual(world.writes[0], ["addLabels", 10, ["agent:needs-human"]]);
    assert.match(world.writes[1][2], /Unknown delegation profile "qa-tester"/);
    assert.equal(world.writes.length, 2);
});

test("synchronize disables auto-merge before issue resolution, with a GITHUB_TOKEN fallback", async () => {
    const syncPayload = { action: "synchronize", pull_request: { number: 20 } };
    const autoMergePr = pipelinePr({ auto_merge: { merge_method: "squash" } });

    // (a) No linked issue has agent:active.
    const none = fakeGitHub({ issues: [{ number: 10, labels: ["type:docs"] }], prs: [autoMergePr] });
    await run(none, handlePullRequestEvent, syncPayload);
    assert.deepEqual(none.pat, [["graphql", "disablePullRequestAutoMerge", { id: "PR_20" }]]);
    assert.match(none.writes.at(-1)[2], /auto-merge disabled/);

    // (b) Two linked issues have agent:active.
    const two = fakeGitHub({
        issues: [
            { number: 10, labels: ["agent:active"] },
            { number: 11, labels: ["agent:active"] },
        ],
        prs: [pipelinePr({ auto_merge: {}, body: "Closes #10\nCloses #11" })],
    });
    await run(two, handlePullRequestEvent, syncPayload);
    assert.deepEqual(two.pat, [["graphql", "disablePullRequestAutoMerge", { id: "PR_20" }]]);
    assert.ok(two.labelsOf(10).includes("agent:needs-human") && two.labelsOf(11).includes("agent:needs-human"));

    // Non-pipeline PRs and PRs without auto-merge are left alone.
    for (const pr of [pipelinePr({ auto_merge: {}, user: { login: "drdave-slalom", type: "User" } }), pipelinePr()]) {
        const world = fakeGitHub({ issues: [{ number: 10, labels: ["type:docs"] }], prs: [pr] });
        await run(world, handlePullRequestEvent, syncPayload);
        assert.deepEqual([world.pat, world.writes], [[], []]);
    }

    // (c) PAT disable throws: GITHUB_TOKEN fallback succeeds.
    const fallback = fakeGitHub({
        issues: [{ number: 10, labels: ["agent:active", "status:review"] }],
        prs: [autoMergePr],
        graphqlErrors: { disablePullRequestAutoMerge: "Resource not accessible" },
    });
    await run(fallback, handlePullRequestEvent, syncPayload);
    assert.deepEqual(fallback.writes.find(([kind]) => kind === "tokenGraphql"), ["tokenGraphql", "disablePullRequestAutoMerge", { id: "PR_20" }]);
    assert.ok(fallback.logs.some((line) => /retrying with GITHUB_TOKEN/.test(line)));
    assert.match(fallback.writes.at(-1)[2], /auto-merge disabled/);
    assert.ok(!fallback.labelsOf(10).includes("agent:needs-human"));

    // (d) Both fail: needs-human when resolvable, and the handler rejects.
    const failing = fakeGitHub({
        issues: [{ number: 10, labels: ["agent:active", "status:review"] }],
        prs: [autoMergePr],
        graphqlErrors: { disablePullRequestAutoMerge: "Resource not accessible" },
        tokenGraphqlError: "Forbidden",
    });
    await assert.rejects(run(failing, handlePullRequestEvent, syncPayload), /could not disable auto-merge on PR #20.*PAT: GraphQL error: Resource not accessible; GITHUB_TOKEN: Forbidden/);
    assert.ok(failing.labelsOf(10).includes("agent:needs-human"));
    assert.match(failing.writes.at(-1)[2], /Agent pipeline stopped.*could not disable auto-merge/);

    const failingUnresolvable = fakeGitHub({
        issues: [{ number: 10, labels: ["type:docs"] }],
        prs: [autoMergePr],
        graphqlErrors: { disablePullRequestAutoMerge: "nope" },
        tokenGraphqlError: "Forbidden",
    });
    await assert.rejects(run(failingUnresolvable, handlePullRequestEvent, syncPayload), /could not disable auto-merge/);
    assert.match(failingUnresolvable.writes.at(-1)[2], /could not disable auto-merge/);
});
