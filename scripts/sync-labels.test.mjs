import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLabelCommands, formatCommand, isInvokedDirectly, main, parseArgs, parseLabels } from "./sync-labels.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labelsFile = path.join(repositoryRoot, ".github", "labels.yml");

const specLabels = [
    "type:feature",
    "type:bug",
    "type:chore",
    "type:docs",
    "role:builder",
    "role:qa",
    "role:review",
    "role:design",
    "role:art",
    "role:docs",
    "lane:A",
    "lane:B",
    "lane:C",
    "status:spec",
    "status:ready",
    "status:in-progress",
    "status:review",
    "blocked",
    "follow-up",
    "playtest",
];

test("labels.yml defines exactly the spec label set with valid colors and descriptions", () => {
    const labels = parseLabels(readFileSync(labelsFile, "utf8"));
    assert.deepEqual(
        labels.map(({ name }) => name),
        specLabels,
    );
    for (const label of labels) {
        assert.match(label.color, /^[0-9a-f]{6}$/);
        assert.ok(label.description.length > 0 && label.description.length <= 100, label.name);
    }
});

test("parser handles quoting, comments, and blank lines", () => {
    const labels = parseLabels(
        [
            "# header",
            "",
            '- name: "type:bug"',
            "  color: D73A4A",
            "  description: 'It''s broken' ",
            "- name: plain-name # trailing comment",
            '  color: "000000"',
            '  description: "Has \\"quotes\\" and: colons"',
        ].join("\n"),
    );
    assert.deepEqual(labels, [
        { name: "type:bug", color: "D73A4A", description: "It's broken" },
        { name: "plain-name", color: "000000", description: 'Has "quotes" and: colons' },
    ]);
});

test("parser rejects invalid definitions", () => {
    const valid = '  color: "ffffff"\n  description: "d"\n';
    assert.throws(() => parseLabels(""), /no labels/);
    assert.throws(() => parseLabels('- name: "a"\n  color: "#ffffff"\n  description: "d"'), /6-digit hex/);
    assert.throws(() => parseLabels('- name: "a"\n  color: "ffffff"'), /missing a description/);
    assert.throws(() => parseLabels(`- name: "a"\n${valid}- name: "A"\n${valid}`), /duplicate label/);
    assert.throws(() => parseLabels(`- name: "a"\n${valid}  extra: "x"`), /unknown key/);
    assert.throws(() => parseLabels(`- name: "a"\n${valid}  color: "000000"`), /duplicate key/);
    assert.throws(() => parseLabels('  name: "a"'), /outside a list item/);
    assert.throws(() => parseLabels("labels: [a, b]"), /unsupported syntax/);
    assert.throws(() => parseLabels('- name: "a\n'), /unterminated/);
});

test("commands use gh label create --force and an optional --repo", () => {
    const labels = [{ name: "type:bug", color: "D73A4A", description: "Something's broken" }];
    assert.deepEqual(buildLabelCommands(labels), [
        ["label", "create", "type:bug", "--color", "d73a4a", "--description", "Something's broken", "--force"],
    ]);
    const [withRepo] = buildLabelCommands(labels, { repo: "drdave-slalom/pacman-256" });
    assert.deepEqual(withRepo.slice(-2), ["--repo", "drdave-slalom/pacman-256"]);
    assert.equal(
        formatCommand(withRepo),
        "gh label create type:bug --color d73a4a --description 'Something'\\''s broken' --force --repo drdave-slalom/pacman-256",
    );
});

test("argument parsing validates options", () => {
    assert.equal(parseArgs([]).dryRun, false);
    assert.deepEqual(
        { ...parseArgs(["--dry-run", "--repo", "o/r"]), file: undefined },
        { dryRun: true, repo: "o/r", file: undefined },
    );
    assert.throws(() => parseArgs(["--repo"]), /requires a value/);
    assert.throws(() => parseArgs(["--repo", "not-a-repo"]), /owner\/name/);
    assert.throws(() => parseArgs(["--force"]), /unknown argument/);
});

test("dry run prints every command and never invokes gh", () => {
    const output = [];
    const run = () => assert.fail("gh must not run in dry-run mode");
    const commands = main(["--dry-run", "--repo", "drdave-slalom/pacman-256"], { run, log: (line) => output.push(line) });
    assert.equal(commands.length, specLabels.length);
    assert.equal(output.length, specLabels.length + 1);
    assert.ok(output.slice(0, -1).every((line) => line.startsWith("[dry-run] gh label create ") && line.includes(" --force --repo drdave-slalom/pacman-256")));
    assert.equal(output.at(-1), `Would sync ${specLabels.length} labels.`);
});

test("live run invokes gh per label and fails on a non-zero exit", () => {
    const calls = [];
    main([], {
        run: (command, args) => {
            calls.push([command, ...args]);
            return { status: 0 };
        },
        log: () => {},
    });
    assert.equal(calls.length, specLabels.length);
    assert.ok(calls.every(([command, , , , , , , , flag]) => command === "gh" && flag === "--force"));

    let invocations = 0;
    assert.throws(
        () =>
            main([], {
                run: () => {
                    invocations += 1;
                    return { status: 1 };
                },
                log: () => {},
            }),
        /gh exited with status 1 for label "type:feature"/,
    );
    assert.equal(invocations, 1);
    assert.throws(() => main([], { run: () => ({ error: new Error("ENOENT") }), log: () => {} }), /could not run gh/);
});

test("issue forms only apply labels defined in labels.yml", () => {
    const defined = new Set(parseLabels(readFileSync(labelsFile, "utf8")).map(({ name }) => name));
    for (const form of ["factory-unit.yml", "bug.yml"]) {
        const text = readFileSync(path.join(repositoryRoot, ".github", "ISSUE_TEMPLATE", form), "utf8");
        const labelsLine = /^labels:\s*\[(.*)\]\s*$/m.exec(text);
        assert.ok(labelsLine, `${form} declares default labels`);
        const used = labelsLine[1].split(",").map((label) => label.trim().replace(/^["']|["']$/g, ""));
        assert.ok(used.length > 0);
        for (const label of used) {
            assert.ok(defined.has(label), `${form} uses undefined label ${label}`);
        }
    }
});

test("entrypoint runs when invoked through a symlinked path", () => {
    const scriptPath = path.join(repositoryRoot, "scripts", "sync-labels.mjs");
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "sync-labels-")));
    try {
        const linkPath = path.join(directory, "sync-labels-link.mjs");
        symlinkSync(scriptPath, linkPath);
        assert.equal(isInvokedDirectly(linkPath, pathToFileURL(scriptPath).href), true);
        assert.equal(isInvokedDirectly(path.join(directory, "missing.mjs")), false);
        assert.equal(isInvokedDirectly(undefined), false);

        const result = spawnSync(process.execPath, [linkPath, "--dry-run"], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^\[dry-run\] gh label create type:feature /m);
        assert.match(result.stdout, new RegExp(`Would sync ${specLabels.length} labels\\.`));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
