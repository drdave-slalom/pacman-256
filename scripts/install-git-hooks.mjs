import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksPath = ".githooks";
const hookFile = path.join(repositoryRoot, hooksPath, "pre-commit");

if (process.env.CI || !existsSync(path.join(repositoryRoot, ".git"))) {
    process.exit(0);
}

let configuredHooksPath = "";
try {
    configuredHooksPath = execFileSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: repositoryRoot,
        encoding: "utf8",
    }).trim();
} catch (error) {
    if (error.status !== 1) {
        throw error;
    }
}

if (configuredHooksPath && path.resolve(repositoryRoot, configuredHooksPath) !== path.resolve(repositoryRoot, hooksPath)) {
    console.warn(`Keeping existing core.hooksPath setting: ${configuredHooksPath}`);
    process.exit(0);
}

chmodSync(hookFile, 0o755);
if (!configuredHooksPath) {
    execFileSync("git", ["config", "--local", "core.hooksPath", hooksPath], {
        cwd: repositoryRoot,
        stdio: "inherit",
    });
}

console.log(`Installed repository Git hooks from ${hooksPath}.`);
