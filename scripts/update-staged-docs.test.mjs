import assert from "node:assert/strict";
import test from "node:test";
import {
    applyTaskStatusUpdates,
    buildCopilotInvocation,
    containsLikelySecret,
    detectDocsBackend,
    getDocumentationPlan,
    parseCopilotResponse,
    readTaskStatuses,
    renderBriefTaskStatus,
    replaceManagedStatusBlock,
    resolveDocumentationUpdates,
    validateCopilotResponse,
} from "./update-staged-docs.mjs";

test("documentation updates run only for implementation and operational config changes", () => {
    assert.deepEqual(getDocumentationPlan(["README.md", "package-lock.json", ".githooks/pre-commit"]), {
        sourcePaths: [],
        docPaths: [],
        syncBrief: false,
        updateTaskStatuses: false,
    });
    assert.deepEqual(getDocumentationPlan(["apps/client/src/main.ts"]), {
        sourcePaths: ["apps/client/src/main.ts"],
        docPaths: ["README.md"],
        syncBrief: true,
        updateTaskStatuses: true,
    });
    assert.deepEqual(getDocumentationPlan(["Dockerfile"]), {
        sourcePaths: ["Dockerfile"],
        docPaths: ["README.md", "deploy/README.md"],
        syncBrief: true,
        updateTaskStatuses: true,
    });
    assert.deepEqual(getDocumentationPlan(["DELIVERY-PLAN.md"]), {
        sourcePaths: [],
        docPaths: [],
        syncBrief: true,
        updateTaskStatuses: false,
    });
    assert.deepEqual(getDocumentationPlan(["apps/server/src/server.ts", "DELIVERY-PLAN.md"]), {
        sourcePaths: ["apps/server/src/server.ts"],
        docPaths: ["README.md"],
        syncBrief: true,
        updateTaskStatuses: true,
    });
});

const taskPlan = [
    "| ID | Status | Chunk / owner | Estimate | Depends on | Acceptance checkpoint |",
    "|---|---|---|---|---|---|",
    "| T0 | Complete | Rules / All | — | — | Approved. |",
    "| T1 | Implemented; validation pending | Skeleton / C | 1 h | T0 | Review and phone check. |",
    "| T2 | Not started | Maze / A | 2 h | T1 | Touch controls work. |",
].join("\n") + "\n";

test("task status updates are monotonic and cannot auto-complete a task", () => {
    const updated = applyTaskStatusUpdates(taskPlan, [
        { id: "T0", status: "In progress" },
        { id: "T1", status: "In progress" },
        { id: "T2", status: "Implemented; validation pending" },
    ]);
    const { statuses } = readTaskStatuses(updated);
    assert.equal(statuses.get("T0").status, "Complete");
    assert.equal(statuses.get("T1").status, "Implemented; validation pending");
    assert.equal(statuses.get("T2").status, "Implemented; validation pending");
    assert.throws(() => applyTaskStatusUpdates(taskPlan, [{ id: "T2", status: "Complete" }]), /cannot assign this task status/);
});

test("brief status summary is rendered from Delivery Plan task statuses", () => {
    const status = renderBriefTaskStatus(taskPlan);
    assert.equal(status, "- T0: Complete.\n- T1: Implemented; validation pending.\n- T2: Not started.");
});

test("Copilot response parser accepts no-op and JSON responses only", () => {
    assert.deepEqual(parseCopilotResponse("NO_DOC_UPDATE_NEEDED"), {
        requiresHumanReview: false,
        updates: [],
        taskStatuses: [],
    });
    assert.deepEqual(parseCopilotResponse('```json\n{"requiresHumanReview":false,"updates":[]}\n```'), {
        requiresHumanReview: false,
        updates: [],
    });
    assert.throws(() => parseCopilotResponse("Here is the update."), /invalid JSON/);
});

test("Copilot cannot update protected documents or include likely credentials", () => {
    assert.throws(
        () => validateCopilotResponse({ requiresHumanReview: true, reason: "Rule change", updates: [] }, ["README.md"]),
        /human review/,
    );
    assert.throws(
        () => validateCopilotResponse({ requiresHumanReview: false, updates: [{ path: "docs/DECISIONS.md", content: "# Decisions\n" }] }, ["README.md"]),
        /protected documentation path/,
    );
    assert.equal(containsLikelySecret("ghp_123456789012345678901234567890123456"), true);
    assert.equal(containsLikelySecret("const greeting = 'hello';"), false);
});

test("Project Brief updates are confined to the managed status block", () => {
    const original = "# Brief\n\n<!-- auto-doc-status:start -->\n- T1: In progress.\n<!-- auto-doc-status:end -->\n\n## Rules\nKeep these.\n";
    const statusText = "- T1: Implemented; verification pending.";
    const updated = replaceManagedStatusBlock(original, statusText);
    assert.match(updated, /## Rules\nKeep these\./);
    assert.match(updated, /<!-- auto-doc-status:start -->\n- T1: Implemented; verification pending\.\n<!-- auto-doc-status:end -->/);
    assert.doesNotThrow(() => validateCopilotResponse({
        requiresHumanReview: false,
        updates: [{ path: "PROJECT-BRIEF.md", content: `${statusText}\n` }],
    }, ["PROJECT-BRIEF.md"], { "PROJECT-BRIEF.md": original }));
    assert.throws(() => validateCopilotResponse({
        requiresHumanReview: false,
        updates: [{ path: "PROJECT-BRIEF.md", content: `${statusText} \n` }],
    }, ["PROJECT-BRIEF.md"], { "PROJECT-BRIEF.md": original }), /trailing whitespace/);
    assert.throws(() => validateCopilotResponse({
        requiresHumanReview: false,
        updates: [{ path: "PROJECT-BRIEF.md", content: "<!-- auto-doc-status:start -->\n- T1: Done.\n<!-- auto-doc-status:end -->\n" }],
    }, ["PROJECT-BRIEF.md"], { "PROJECT-BRIEF.md": original }), /without boundary markers/);
    assert.throws(() => replaceManagedStatusBlock(original, ""), /empty or contains boundary markers/);
});

test("docs backend selection honors Pi session environment and DOCS_LLM override", () => {
    const saved = {
        DOCS_LLM: process.env.DOCS_LLM,
        PI_CODING_AGENT: process.env.PI_CODING_AGENT,
        HERDR_BIN_PATH: process.env.HERDR_BIN_PATH,
    };
    try {
        delete process.env.DOCS_LLM;
        delete process.env.PI_CODING_AGENT;
        delete process.env.HERDR_BIN_PATH;
        assert.equal(detectDocsBackend(), "copilot");
        process.env.PI_CODING_AGENT = "1";
        assert.equal(detectDocsBackend(), "pi");
        delete process.env.PI_CODING_AGENT;
        process.env.HERDR_BIN_PATH = "/tmp/herdr";
        assert.equal(detectDocsBackend(), "pi");
        delete process.env.HERDR_BIN_PATH;
        process.env.DOCS_LLM = "copilot";
        assert.equal(detectDocsBackend(), "copilot");
        process.env.DOCS_LLM = "PI";
        assert.equal(detectDocsBackend(), "pi");
        process.env.DOCS_LLM = "anthropic";
        assert.throws(() => detectDocsBackend(), /Unknown DOCS_LLM backend/);
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});

test("Copilot prompt is sent on stdin, never in argv", () => {
    const prompt = `Update docs.\n${"x".repeat(120_000)}\nPROMPT_SENTINEL`;
    const invocation = buildCopilotInvocation(prompt, { PATH: "/usr/bin", HOME: "/home/test", SECRET_VALUE: "nope" });
    assert.equal(invocation.command, "copilot");
    assert.deepEqual(invocation.args, ["-s", "--no-ask-user"]);
    assert.ok(!invocation.args.includes("-p"));
    assert.ok(invocation.args.every((argument) => !argument.includes("PROMPT_SENTINEL") && !argument.includes("Update docs.")));
    assert.equal(invocation.options.input, prompt);
    assert.equal(invocation.options.encoding, "utf8");
    assert.equal(invocation.options.timeout, 180_000);
    assert.equal(invocation.options.env.PATH, "/usr/bin");
    assert.equal(invocation.options.env.NO_COLOR, "1");
    assert.ok(!("SECRET_VALUE" in invocation.options.env));
});

test("validated response is applied after the retry loop (task statuses, docs, brief)", () => {
    const brief = "# Brief\n\n<!-- auto-doc-status:start -->\n- stale.\n<!-- auto-doc-status:end -->\n";
    const replies = [
        "Here is the update.",
        JSON.stringify({
            requiresHumanReview: false,
            updates: [{ path: "README.md", content: "# Readme\n\nUpdated.\n" }],
            taskStatuses: [{ id: "T2", status: "In progress" }],
        }),
    ];
    const prompts = [];
    const { backend, changedUpdates } = resolveDocumentationUpdates({
        prompt: "PROMPT",
        plan: { sourcePaths: ["apps/client/src/main.ts"], docPaths: ["README.md"], syncBrief: true, updateTaskStatuses: true },
        currentDocs: { "README.md": "# Readme\n" },
        currentDeliveryPlan: taskPlan,
        currentBrief: brief,
        generate: (prompt) => {
            prompts.push(prompt);
            return { backend: "copilot", stdout: replies[prompts.length - 1] };
        },
    });
    assert.equal(backend, "copilot");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /previous reply failed validation/);
    const byPath = Object.fromEntries(changedUpdates.map(({ path, content }) => [path, content]));
    assert.deepEqual(Object.keys(byPath).sort(), ["DELIVERY-PLAN.md", "PROJECT-BRIEF.md", "README.md"]);
    assert.equal(byPath["README.md"], "# Readme\n\nUpdated.\n");
    assert.equal(readTaskStatuses(byPath["DELIVERY-PLAN.md"]).statuses.get("T2").status, "In progress");
    assert.match(byPath["PROJECT-BRIEF.md"], /- T2: In progress\./);
});
