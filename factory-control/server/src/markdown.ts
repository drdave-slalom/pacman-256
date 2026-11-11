import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalId, tokensOf } from "./canonical.ts";

export interface SpecUnit {
  /** Path relative to the repo root, e.g. `SPEC/T3-foo.md`. */
  path: string;
  /** Canonical unit id derived from the file name. */
  id: string;
  tokens: Set<string>;
  title?: string;
  goal?: string;
  lane?: string;
  /** GitHub issue numbers referenced in this spec (`#N` / `Closes #N`). */
  issueRefs?: number[];
  parseError?: string;
}

/**
 * Collect GitHub issue numbers referenced as `#N` (or `Closes #N`) in a
 * markdown body. Markdown ATX headings (`# Title`) and word-embedded `#`
 * (e.g. `result:fc-issue-sync-shared#1`) are excluded, so only standalone
 * `#<digits>` tokens are captured. Returns unique numbers in ascending order.
 */
export function referencedIssueNumbers(content: string): number[] {
  const numbers: number[] = [];
  const re = /(?:^|[^\w#])#(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const n = Number.parseInt(m[1]!, 10);
    if (!numbers.includes(n)) numbers.push(n);
  }
  return numbers.sort((a, b) => a - b);
}

/**
 * Collect every `SPEC/*.md` unit in the repo. The factory's unit vocabulary is
 * a SPEC markdown file in the repo (spec §Assumptions); this covers both the
 * repo-root `SPEC/` and the workstream-local `factory-control/SPEC/`.
 */
export function findSpecFiles(repoRoot: string): string[] {
  const rel: string[] = [];
  for (const dir of ["SPEC", join("factory-control", "SPEC")]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(repoRoot, dir));
    } catch {
      continue; // missing dir → no specs there
    }
    for (const entry of entries) {
      if (entry.endsWith(".md")) rel.push(join(dir, entry));
    }
  }
  return rel.sort();
}

function firstHeadingLine(content: string, pattern: RegExp): number {
  for (const [i, line] of content.split(/\r?\n/).entries()) {
    if (pattern.test(line)) return i;
  }
  return -1;
}

/**
 * Parse a single SPEC file. Reading is defensive: an unreadable file still
 * yields a unit with `parseError` set.
 */
export function readSpecUnit(repoRoot: string, relPath: string): SpecUnit {
  const name = basename(relPath);
  const unit: SpecUnit = {
    path: relPath,
    id: canonicalId(name),
    tokens: tokensOf(name),
  };

  let content: string;
  try {
    content = readFileSync(join(repoRoot, relPath), "utf8");
  } catch (error) {
    unit.parseError = error instanceof Error ? error.message : String(error);
    return unit;
  }

  // Referenced issue numbers are collected from the whole file (including any
  // frontmatter tracker fields); headings are excluded by the matcher.
  unit.issueRefs = referencedIssueNumbers(content);

  // Strip optional frontmatter so it cannot masquerade as an H1.
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) content = content.slice(end + 4);
  }

  for (const line of content.split(/\r?\n/)) {
    const h1 = line.match(/^#[ \t]+(.+)$/);
    if (h1) {
      const title = h1[1]?.trim();
      if (title !== undefined) {
        unit.title = title;
        // The first H1 ends the title search; keep scanning for the goal.
        break;
      }
    }
  }

  // Goal: the paragraph under a "## Goal" heading (fallback: first paragraph).
  const lines = content.split(/\r?\n/);
  const goalHeading = firstHeadingLine(content, /^#{2,3}[ \t]+Goal[ \t]*$/i);
  const start = goalHeading >= 0 ? goalHeading + 1 : 0;
  const goalLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("#")) break;
    if (line.trim() === "") {
      if (goalLines.length > 0 && goalHeading >= 0) break;
      continue;
    }
    goalLines.push(line.trim());
    if (goalHeading < 0 && goalLines.length >= 1) break;
  }
  if (goalLines.length > 0) unit.goal = goalLines.join(" ").slice(0, 600);

  const lane = content.match(/Lane:[ \t]*([A-Za-z0-9_-]+)/i);
  if (lane && lane[1] !== undefined) unit.lane = lane[1];

  return unit;
}
