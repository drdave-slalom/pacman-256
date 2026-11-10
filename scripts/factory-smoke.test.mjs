import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENTS_DIR = join(ROOT, ".github", "agents");
const SETUP_SCRIPT = join(ROOT, "scripts", "factory-setup.sh");
const READ_ONLY_TOOLS = new Set(["read", "search"]);

function readFrontmatter(path) {
    const match = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(match, `${path} has no frontmatter block`);
    const fields = {};
    for (const line of match[1].split("\n")) {
        const field = line.match(/^([A-Za-z-]+):\s*(.*)$/);
        if (field) fields[field[1]] = field[2].trim();
    }
    return fields;
}

function parseToolList(value) {
    const list = value?.match(/^\[(.*)\]$/);
    assert.ok(list, `tools must be an inline list, got: ${value}`);
    return list[1].split(",").map((tool) => tool.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function agentFiles() {
    return readdirSync(AGENTS_DIR).filter((file) => file.endsWith(".agent.md")).sort();
}

function setupRoleDefs() {
    const match = readFileSync(SETUP_SCRIPT, "utf8").match(/^ROLE_DEFS="([^"]+)"/m);
    assert.ok(match, "ROLE_DEFS not found in factory-setup.sh");
    return match[1].split(/\s+/).sort();
}

function runCopilotSetup(scriptPath) {
    return spawnSync("bash", [scriptPath, "--copilot", "--quiet"], {
        encoding: "utf8",
        env: { ...process.env, PATH: dirname(process.execPath) + ":/usr/bin:/bin" },
    });
}

function git(cwd, ...args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeFactoryCopy() {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "factory-smoke-")));
    const repo = join(parent, "repo");
    for (const path of [".github/agents", ".github/skills", "scripts/factory-setup.sh", "scripts/factory-worktree.sh", "docs/FACTORY.md", "docs/DECISIONS.md", "docs/GAME-CONTRACT.md"]) {
        cpSync(join(ROOT, path), join(repo, path), { recursive: true });
    }
    git(repo, "init", "--quiet");
    return { parent, repo };
}

test("every Copilot agent profile has a matching name, description, and role skill", () => {
    const files = agentFiles();
    assert.ok(files.length > 0, "no .github/agents/*.agent.md profiles found");
    for (const file of files) {
        const role = basename(file, ".agent.md");
        const fields = readFrontmatter(join(AGENTS_DIR, file));
        assert.equal(fields.name, role, `${file} frontmatter name`);
        assert.ok(fields.description, `${file} needs a non-empty description`);
        assert.ok(existsSync(join(ROOT, ".github", "skills", role, "SKILL.md")), `${file} has no .github/skills/${role}/SKILL.md`);
    }
});

test("factory-setup.sh role list matches the Copilot agent profiles", () => {
    const profiles = agentFiles().map((file) => basename(file, ".agent.md")).filter((role) => role !== "factory-orchestrator");
    assert.deepEqual(setupRoleDefs(), profiles);
});

test("pr-reviewer profile is restricted to read-only tools", () => {
    const tools = parseToolList(readFrontmatter(join(AGENTS_DIR, "pr-reviewer.agent.md")).tools);
    assert.ok(tools.length > 0, "pr-reviewer must declare a tools allow-list");
    for (const tool of tools) assert.ok(READ_ONLY_TOOLS.has(tool), `pr-reviewer has non-read-only tool: ${tool}`);
});

test("factory-setup.sh --copilot passes without Pi or Herdr on PATH", () => {
    const result = runCopilotSetup(SETUP_SCRIPT);
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("factory-setup.sh --copilot fails when an agent profile is missing or misnamed", () => {
    const { parent, repo } = makeFactoryCopy();
    try {
        const script = join(repo, "scripts", "factory-setup.sh");
        assert.equal(runCopilotSetup(script).status, 0, "baseline copy should pass");

        const reviewer = join(repo, ".github", "agents", "pr-reviewer.agent.md");
        const original = readFileSync(reviewer, "utf8");
        writeFileSync(reviewer, original.replace(/^name: pr-reviewer$/m, "name: reviewer"));
        const misnamed = runCopilotSetup(script);
        assert.equal(misnamed.status, 1);
        assert.match(misnamed.stdout, /pr-reviewer\.agent\.md has invalid name/);

        rmSync(reviewer);
        const missing = runCopilotSetup(script);
        assert.equal(missing.status, 1);
        assert.match(missing.stdout, /Copilot agent missing: \.github\/agents\/pr-reviewer\.agent\.md/);
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
});

test("factory-worktree.sh isolates a unit in a sibling checkout and removes it cleanly", () => {
    const { parent, repo } = makeFactoryCopy();
    try {
        writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "factory-smoke", version: "0.0.0", private: true }));
        writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ name: "factory-smoke", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "factory-smoke", version: "0.0.0" } } }));
        git(repo, "add", "-A");
        git(repo, "-c", "user.name=smoke", "-c", "user.email=smoke@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "base");

        const worktreeScript = join(repo, "scripts", "factory-worktree.sh");
        const created = execFileSync("bash", [worktreeScript, "create", "smoke"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const worktree = created.match(/^WORKTREE=(.+)$/m)?.[1];
        assert.equal(worktree, join(parent, "repo-wt-smoke"));
        assert.match(created, /^BRANCH=factory\/smoke$/m);
        assert.equal(git(worktree, "rev-parse", "--show-toplevel"), worktree);
        assert.equal(git(worktree, "branch", "--show-current"), "factory/smoke");

        mkdirSync(join(worktree, "notes"));
        writeFileSync(join(worktree, "notes", "unit.txt"), "isolated change\n");
        assert.equal(existsSync(join(repo, "notes", "unit.txt")), false);
        assert.equal(git(repo, "status", "--porcelain"), "");

        rmSync(join(worktree, "notes"), { recursive: true });
        execFileSync("bash", [worktreeScript, "remove", "smoke"], { cwd: repo, stdio: "ignore" });
        assert.equal(existsSync(worktree), false);
        assert.equal(git(repo, "branch", "--list", "factory/smoke"), "");
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
});
