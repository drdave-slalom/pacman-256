import assert from "node:assert/strict";
import test from "node:test";
import {
    BUILD_PROFILES,
    buildInstructions,
    createPatClient,
    extractSection,
    findQaVerdict,
    fixInstructions,
    gateMarker,
    handleApproveSpec,
    handleDispatch,
    hasCopilotReview,
    hasRole,
    isCopilotAuthor,
    isSensitivePath,
    isWipTitle,
    latestRunState,
    mergeDecision,
    nextCycle,
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
} from "./agent-gate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("sensitive paths cover workflow, deploy, scripts, manifests, Dockerfile, and the factory server", () => {
    for (const path of [
        ".github/workflows/ci.yml",
        ".github/agents/builder.agent.md",
        "deploy/README.md",
        "Dockerfile",
        "./Dockerfile",
        "scripts/sync-labels.mjs",
        "package.json",
        "package-lock.json",
        "apps/client/package.json",
        "factory-control/server/src/index.ts",
    ]) {
        assert.equal(isSensitivePath(path), true, path);
    }
    for (const path of ["docs/FACTORY.md", "SPEC/T6-x.md", "apps/client/src/main.ts", "factory-control/web/src/app.ts", "README.md", "github/x", "deployment.md"]) {
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
    assert.deepEqual(mergeDecision({ labels: ["role:builder"], files: docs }).reason, "no-low-risk-type");
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
        "- builder: Wire the counter into tests",
        "- QA depth: slow",
        "## Out of scope",
        "- gameplay-designer: not delegation either",
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

test("delegation parsing reports unknown, malformed, and missing roles instead of defaulting", () => {
    assert.deepEqual(parseDelegation("# Spec\n\nNo delegation.").errors, ["The spec has no `## Delegation` section."]);
    assert.match(parseDelegation("## Delegation\n- qa-tester: run tests\n- QA depth: fast").errors[0], /Unknown delegation profile "qa-tester"/);
    assert.match(parseDelegation("## Delegation\n- pr-reviewer: review").errors[0], /Unknown delegation profile/);
    assert.match(parseDelegation("## Delegation\n- just do it").errors[0], /not in the form/);
    assert.match(parseDelegation("## Delegation\n- QA depth: fast").errors[0], /lists no/);
    assert.match(parseDelegation("## Delegation\n- builder: x\n- QA depth: thorough").errors[0], /QA depth must be/);
    const noDepth = parseDelegation("## Delegation\n- builder: x");
    assert.deepEqual([noDepth.errors, noDepth.qaDepth, noDepth.warnings.length], [[], "fast", 1]);
    assert.equal(parseDelegation("## Delegation\n- artist: sprite\nQA depth: **fast**.").qaDepth, "fast");
});

test("follow-up parsing skips None/N/A, comments, nested items, and generated text; caps at five", () => {
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
        "<!-- auto-generated-pr-description:start -->",
        "- not a follow-up",
        "<!-- auto-generated-pr-description:end -->",
    ].join("\n");
    assert.deepEqual(parseFollowUps(body), { items: ["Tighten the timer copy", "Add a phone screenshot", "Rename helper"], skipped: 0 });
    assert.deepEqual(parseFollowUps("## Follow-ups\n\nNone\n- None.\n- n/a"), { items: [], skipped: 0 });
    assert.deepEqual(parseFollowUps("## Summary\n- a"), { items: [], skipped: 0 });
    const many = `## Follow-ups\n${Array.from({ length: 7 }, (_, index) => `- item ${index + 1}`).join("\n")}\n## Next`;
    assert.deepEqual(parseFollowUps(many), { items: ["item 1", "item 2", "item 3", "item 4", "item 5"], skipped: 2 });
});

test("cycle increment follows D050: cycle:1, then cycle:2, then exhausted", () => {
    assert.deepEqual(nextCycle([]), { exhausted: false, label: "cycle:1" });
    assert.deepEqual(nextCycle([{ name: "cycle:1" }]), { exhausted: false, label: "cycle:2" });
    assert.deepEqual(nextCycle(["cycle:1", "cycle:2"]), { exhausted: true, label: null });
    assert.deepEqual(nextCycle(["cycle:2"]), { exhausted: true, label: null });
});

test("linked issues come from closing keywords outside HTML comments", () => {
    assert.deepEqual(parseLinkedIssues("## Linked issue\n\n<!-- `Closes #<n>` -->\nCloses #\n\nCloses #12\n\nFixes #12, fixes: #7 and resolves #3"), [12, 7, 3]);
    assert.deepEqual(parseLinkedIssues("<!-- Closes #9 -->See #4"), []);
    assert.deepEqual(parseLinkedIssues(null), []);
});

test("roles, authors, titles, and section extraction", () => {
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
    assert.equal(isCopilotAuthor(undefined), false);
    assert.equal(isWipTitle("[WIP] Add docs"), true);
    assert.equal(isWipTitle("Add docs [WIP]"), false);
    assert.equal(extractSection("## A\nx\n### sub\ny\n## B\nz", "a"), "x\n### sub\ny");
});

test("spec paths use the unit ID when present, else the issue number", () => {
    assert.equal(specPathFor({ number: 40, title: "T6: Pickups & shield timing!", body: "" }), "SPEC/T6-pickups-shield-timing.md");
    assert.equal(specPathFor({ number: 41, title: "Lobby polish", body: "### Unit ID\n\nT7\n\n### Goal" }), "SPEC/T7-lobby-polish.md");
    assert.equal(specPathFor({ number: 42, title: "Fix README typo", body: null }), "SPEC/issue-42-fix-readme-typo.md");
    assert.equal(specPathFor({ number: 43, title: "!!!" }), "SPEC/issue-43-unit.md");
});

test("review, QA, and check helpers read only trusted verdicts for the head SHA", () => {
    const bot = { login: "github-actions[bot]" };
    const reviews = [
        { user: bot, commit_id: SHA, state: "CHANGES_REQUESTED", body: "x" },
        { user: { login: "mallory" }, commit_id: SHA, state: "APPROVED" },
        { user: bot, commit_id: "old", state: "APPROVED" },
        { user: bot, commit_id: SHA, state: "APPROVED", body: "ok" },
        { user: { login: "copilot-pull-request-reviewer[bot]" }, commit_id: "old", state: "COMMENTED" },
    ];
    assert.equal(pickFactoryReview(reviews, SHA).state, "APPROVED");
    assert.equal(pickFactoryReview(reviews, "other"), null);
    assert.equal(hasCopilotReview(reviews), true);
    assert.equal(hasCopilotReview(reviews.slice(0, 4)), false);

    const comments = [
        { user: bot, body: `<!-- factory-qa:fail -->\nHead: ${SHA}` },
        { user: { login: "mallory" }, body: `<!-- factory-qa:pass -->\nHead: ${SHA}` },
        { user: bot, body: "<!-- factory-qa:pass -->\nHead: old" },
        { user: bot, body: `<!-- factory-qa:pass --><!-- factory-qa:fail -->\nHead: ${SHA}` },
    ];
    assert.equal(findQaVerdict(comments, SHA).verdict, "fail");
    assert.equal(findQaVerdict([...comments, { user: bot, body: `<!-- factory-qa:pass -->\n${SHA}` }], SHA).verdict, "pass");
    assert.equal(findQaVerdict(comments, "missing"), null);

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

    assert.deepEqual(latestRunState([]), { done: false, run: null });
    const runs = [
        { id: 1, event: "pull_request", created_at: "2026-01-01T00:00:00Z", status: "completed", conclusion: "skipped" },
        { id: 2, event: "pull_request", created_at: "2026-01-01T00:05:00Z", status: "in_progress", conclusion: null },
        { id: 3, event: "workflow_dispatch", created_at: "2026-01-01T00:09:00Z", status: "completed", conclusion: "success" },
    ];
    assert.deepEqual([latestRunState(runs).done, latestRunState(runs).run.id], [false, 2]);
    assert.equal(latestRunState([{ ...runs[1], status: "completed", conclusion: "failure" }]).done, true);
    assert.equal(latestRunState(runs.slice(0, 1)).done, false);
});

test("instruction text names the spec, profiles, and required rules", () => {
    const spec = specInstructions({ issueNumber: 9, specPath: "SPEC/issue-9-x.md" });
    assert.match(spec, /Spec only/);
    assert.match(spec, /SPEC\/issue-9-x\.md/);
    assert.match(spec, /## Delegation/);
    assert.match(spec, /Closes #9/);
    const build = buildInstructions({ issueNumber: 9, specPath: "SPEC/a.md", steps: [{ profile: "artist", task: "Draw" }], qaDepth: "fast" });
    assert.match(build, /^@copilot /);
    assert.match(build, /\.github\/agents\/artist\.agent\.md/);
    assert.match(build, /npm run check/);
    assert.match(build, /Closes #9/);
    assert.match(build, /auto-generated-pr-description:start/);
    const fix = fixInstructions({ blockers: [{ source: "QA", details: "> boom" }], cycleLabel: "cycle:1", steps: [], sha: SHA });
    assert.match(fix, /^@copilot /);
    assert.ok(fix.endsWith(gateMarker("fix", SHA)));
});

test("PAT client sends bearer auth and surfaces API and GraphQL errors", async () => {
    assert.throws(() => createPatClient(""), /COPILOT_ASSIGN_TOKEN/);
    const calls = [];
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    const responses = [reply(201, { ok: true }), reply(422, { message: "Validation Failed" }), reply(200, { errors: [{ message: "clean status" }] })];
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
});

// ---------------------------------------------------------------------------
// Handler guards with a fake github-script environment
// ---------------------------------------------------------------------------

function fakeEnvironment({ role = "admin", issue, pr, files = [], fileContent = "", activeIssues = [] }) {
    const writes = [];
    const notFound = Object.assign(new Error("Not Found"), { status: 404 });
    const github = {
        paginate: async (method, params) => method(params).then(({ data }) => data),
        request: async () => ({ data: [] }),
        rest: {
            repos: {
                getCollaboratorPermissionLevel: async () => {
                    if (role === null) {
                        throw notFound;
                    }
                    return { data: { role_name: role } };
                },
                getContent: async () => ({ data: { content: Buffer.from(fileContent).toString("base64"), encoding: "base64" } }),
            },
            issues: {
                get: async ({ issue_number }) => ({ data: issue_number === issue?.number ? issue : { number: issue_number, labels: [] } }),
                listForRepo: async () => ({ data: activeIssues }),
                addLabels: async (params) => writes.push(["addLabels", params.issue_number, params.labels]),
                removeLabel: async (params) => writes.push(["removeLabel", params.issue_number, params.name]),
                createComment: async (params) => writes.push(["comment", params.issue_number, params.body]),
            },
            pulls: {
                get: async () => ({ data: pr }),
                listFiles: async () => ({ data: files }),
                update: async (params) => writes.push(["updatePull", params.pull_number, params.title]),
            },
        },
    };
    const logs = [];
    const core = { info: (line) => logs.push(line), warning: (line) => logs.push(line), setFailed: (line) => writes.push(["failed", line]) };
    return { github, core, writes, logs };
}

const repoContext = (payload) => ({ repo: { owner: "drdave-slalom", repo: "pacman-256" }, payload });

test("dispatch ignores labelers below triage and never calls the PAT", async () => {
    const issue = { number: 5, state: "open", title: "Docs", labels: [{ name: "agent:go" }], assignees: [] };
    for (const role of [null, "read"]) {
        const { github, core, writes } = fakeEnvironment({ role, issue });
        const context = repoContext({ label: { name: "agent:go" }, issue, sender: { login: "stranger" } });
        await handleDispatch({ github, context, core, env: { COPILOT_ASSIGN_TOKEN: "pat" } });
        assert.deepEqual(writes, []);
    }
});

test("dispatch respects needs-human, Copilot assignment, and the active limit", async () => {
    const base = { number: 5, state: "open", title: "Docs", assignees: [] };
    const run = async (issue, activeIssues = []) => {
        const env = fakeEnvironment({ issue, activeIssues });
        const context = repoContext({ label: { name: "agent:go" }, issue, sender: { login: "drdave-slalom" } });
        let fetched = false;
        const original = globalThis.fetch;
        globalThis.fetch = async () => {
            fetched = true;
            throw new Error("unexpected PAT call");
        };
        try {
            await handleDispatch({ github: env.github, context, core: env.core, env: { COPILOT_ASSIGN_TOKEN: "pat" } });
        } finally {
            globalThis.fetch = original;
        }
        return { ...env, fetched };
    };
    const needsHuman = await run({ ...base, labels: [{ name: "agent:go" }, { name: "agent:needs-human" }] });
    assert.equal(needsHuman.fetched, false);
    assert.deepEqual(needsHuman.writes.map(([kind]) => kind), ["comment"]);

    const assigned = await run({ ...base, labels: [{ name: "agent:go" }], assignees: [{ login: "Copilot" }] });
    assert.deepEqual([assigned.fetched, assigned.writes], [false, []]);

    const full = await run({ ...base, labels: [{ name: "agent:go" }] }, [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4, pull_request: {} }]);
    assert.equal(full.fetched, false);
    assert.equal(full.writes.length, 1);
    assert.match(full.writes[0][2], /limit 3/);
});

test("approve-spec ignores commenters without write and non-Copilot PRs", async () => {
    const issue = { number: 5, labels: [{ name: "agent:active" }, { name: "status:spec" }] };
    const pr = { number: 6, user: { login: "Copilot" }, body: "Closes #5", title: "Spec", head: { sha: SHA } };
    const payload = { issue: { number: 6, pull_request: {} }, comment: { body: "/approve-spec", user: { login: "helper" } } };
    const triage = fakeEnvironment({ role: "triage", issue, pr });
    await handleApproveSpec({ github: triage.github, context: repoContext(payload), core: triage.core, env: {} });
    assert.deepEqual(triage.writes, []);

    const human = fakeEnvironment({ issue, pr: { ...pr, user: { login: "drdave-slalom" } } });
    await handleApproveSpec({ github: human.github, context: repoContext(payload), core: human.core, env: {} });
    assert.deepEqual(human.writes, []);
});

test("approve-spec stops at needs-human for an unknown delegation profile", async () => {
    const issue = { number: 5, labels: [{ name: "agent:active" }, { name: "status:spec" }] };
    const pr = { number: 6, user: { login: "Copilot" }, body: "Fixes #5", title: "Spec", head: { sha: SHA } };
    const env = fakeEnvironment({
        issue,
        pr,
        files: [{ filename: "SPEC/issue-5-docs.md", status: "added" }],
        fileContent: "## Delegation\n- qa-tester: run everything\n- QA depth: fast\n",
    });
    const payload = { issue: { number: 6, pull_request: {} }, comment: { body: "/approve-spec", user: { login: "drdave-slalom" } } };
    await handleApproveSpec({ github: env.github, context: repoContext(payload), core: env.core, env: { COPILOT_ASSIGN_TOKEN: "pat" } });
    assert.deepEqual(env.writes[0], ["addLabels", 5, ["agent:needs-human"]]);
    assert.equal(env.writes[1][0], "comment");
    assert.equal(env.writes[1][1], 6);
    assert.match(env.writes[1][2], /Unknown delegation profile "qa-tester"/);
    assert.equal(env.writes.length, 2);
});
