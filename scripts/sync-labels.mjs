// Sync repository labels from .github/labels.yml using the GitHub CLI.
//
// Usage: node scripts/sync-labels.mjs [--dry-run] [--repo owner/name] [--file path]
//
// Each label is applied with `gh label create <name> --color <hex> --description <text> --force`,
// which creates missing labels and updates existing ones, so repeated runs are idempotent.
// Labels not listed in the file (including GitHub defaults) are left untouched.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLabelsFile = path.join(repositoryRoot, ".github", "labels.yml");
const allowedKeys = new Set(["name", "color", "description"]);

function parseScalar(raw, lineNumber) {
    const value = raw.trim();
    if (value.startsWith('"')) {
        if (!value.endsWith('"') || value.length < 2) {
            throw new Error(`line ${lineNumber}: unterminated double-quoted value`);
        }
        return JSON.parse(value);
    }
    if (value.startsWith("'")) {
        if (!value.endsWith("'") || value.length < 2) {
            throw new Error(`line ${lineNumber}: unterminated single-quoted value`);
        }
        return value.slice(1, -1).replaceAll("''", "'");
    }
    // Plain scalar: strip a trailing " # comment".
    return value.replace(/\s+#.*$/, "");
}

/**
 * Parse the flat YAML list used by .github/labels.yml:
 *   - name: "type:bug"
 *     color: "d73a4a"
 *     description: "Something is broken"
 * Only this subset is supported (comments, blank lines, quoted or plain scalars).
 */
export function parseLabels(text) {
    const labels = [];
    let current = null;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index];
        if (line.trim() === "" || line.trim().startsWith("#")) {
            continue;
        }
        const match = /^(-\s+|\s+)([A-Za-z_]+):(?:\s+(.*))?$/.exec(line);
        if (!match) {
            throw new Error(`line ${lineNumber}: unsupported syntax: ${line}`);
        }
        const [, prefix, key, rawValue = ""] = match;
        if (prefix.startsWith("-")) {
            current = {};
            labels.push(current);
        } else if (!current) {
            throw new Error(`line ${lineNumber}: property outside a list item`);
        }
        if (!allowedKeys.has(key)) {
            throw new Error(`line ${lineNumber}: unknown key "${key}"`);
        }
        if (Object.hasOwn(current, key)) {
            throw new Error(`line ${lineNumber}: duplicate key "${key}"`);
        }
        current[key] = parseScalar(rawValue, lineNumber);
    }
    validateLabels(labels);
    return labels;
}

export function validateLabels(labels) {
    if (labels.length === 0) {
        throw new Error("no labels defined");
    }
    const seen = new Set();
    for (const label of labels) {
        if (!label.name) {
            throw new Error("label is missing a name");
        }
        const key = label.name.toLowerCase();
        if (seen.has(key)) {
            throw new Error(`duplicate label "${label.name}"`);
        }
        seen.add(key);
        if (!/^[0-9a-fA-F]{6}$/.test(label.color ?? "")) {
            throw new Error(`label "${label.name}" needs a 6-digit hex color without #`);
        }
        if (typeof label.description !== "string" || label.description.length === 0) {
            throw new Error(`label "${label.name}" is missing a description`);
        }
        if (label.description.length > 100) {
            throw new Error(`label "${label.name}" description exceeds GitHub's 100-character limit`);
        }
    }
}

export function buildLabelCommands(labels, { repo } = {}) {
    return labels.map((label) => {
        const args = [
            "label",
            "create",
            label.name,
            "--color",
            label.color.toLowerCase(),
            "--description",
            label.description,
            "--force",
        ];
        if (repo) {
            args.push("--repo", repo);
        }
        return args;
    });
}

function shellQuote(argument) {
    return /^[A-Za-z0-9_./:@=-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(args) {
    return ["gh", ...args].map(shellQuote).join(" ");
}

export function parseArgs(argv) {
    const options = { dryRun: false, repo: undefined, file: defaultLabelsFile };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--dry-run") {
            options.dryRun = true;
        } else if (argument === "--repo" || argument === "--file") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) {
                throw new Error(`${argument} requires a value`);
            }
            index += 1;
            if (argument === "--repo") {
                if (!/^[\w.-]+\/[\w.-]+$/.test(value)) {
                    throw new Error(`--repo must be owner/name, got "${value}"`);
                }
                options.repo = value;
            } else {
                options.file = path.resolve(value);
            }
        } else {
            throw new Error(`unknown argument "${argument}"`);
        }
    }
    return options;
}

export function main(argv = process.argv.slice(2), { run = spawnSync, log = console.log } = {}) {
    const options = parseArgs(argv);
    const labels = parseLabels(readFileSync(options.file, "utf8"));
    const commands = buildLabelCommands(labels, { repo: options.repo });
    for (const args of commands) {
        log(`${options.dryRun ? "[dry-run] " : ""}${formatCommand(args)}`);
        if (options.dryRun) {
            continue;
        }
        const result = run("gh", args, { stdio: "inherit" });
        if (result.error) {
            throw new Error(`could not run gh: ${result.error.message}`);
        }
        if (result.status !== 0) {
            throw new Error(`gh exited with status ${result.status} for label "${args[2]}"`);
        }
    }
    log(`${options.dryRun ? "Would sync" : "Synced"} ${commands.length} labels.`);
    return commands;
}

// Compare real paths so invocation through a symlinked path still runs the script.
export function isInvokedDirectly(argvPath = process.argv[1], moduleUrl = import.meta.url) {
    if (!argvPath) {
        return false;
    }
    try {
        return realpathSync(path.resolve(argvPath)) === realpathSync(fileURLToPath(moduleUrl));
    } catch {
        return false;
    }
}

if (isInvokedDirectly()) {
    try {
        main();
    } catch (error) {
        console.error(`sync-labels: ${error.message}`);
        process.exitCode = 1;
    }
}
