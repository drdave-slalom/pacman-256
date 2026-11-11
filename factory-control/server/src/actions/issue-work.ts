/**
 * Issue-card → factory-work derivation helpers for the `factory/start-work`
 * action (U5). Shared by the action definition (plan/steps) and its
 * preconditions (guards) so both derive the same unit id, spec path, role,
 * and acceptance text.
 */

import type { IssueCard } from "../types.ts";

/** A leading unit token like `T7` (case-insensitive, followed by a separator). */
const UNIT_TOKEN_RE = /^(T\d+)(?:[-_\s:]|$)/i;
/** A leading `fc-…` slug token (the factory-control workstream prefix pattern). */
const FC_TOKEN_RE = /^(fc-[a-z0-9]+(?:-[a-z0-9]+)*)(?:[-_\s:]|$)/i;

/**
 * Derive the factory unit id from an issue card. If the issue title starts
 * with a unit token (`T<n>` or `fc-…`/`<slug>` prefix) it is used verbatim
 * (lowercased); otherwise the id is `issue<n>` (n = issue number).
 */
export function deriveIssueUnitId(issue: IssueCard): string {
  const title = issue.title.trim();
  let id = "";
  const m = title.match(UNIT_TOKEN_RE);
  if (m !== null && m[1] !== undefined) {
    id = m[1].toLowerCase();
  } else {
    const f = title.match(FC_TOKEN_RE);
    if (f !== null && f[1] !== undefined) id = f[1].toLowerCase();
  }
  if (id === "") id = `issue${String(issue.number)}`;
  return id;
}

/** Slugify a title: lowercased, non-alphanumerics → single dashes, trimmed. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug !== "" ? slug : "untitled";
}

/** The repo-relative spec path scaffolded for an issue card. */
export function issueSpecPath(issue: IssueCard): string {
  return `SPEC/${deriveIssueUnitId(issue)}-${slugifyTitle(issue.title)}.md`;
}

/** Role profile from the issue's first `role:*` label; default `builder`. */
export function issueRole(issue: IssueCard): string {
  const role = (issue.labels.role ?? []).find((r) => r.trim() !== "");
  return role !== undefined ? role.toLowerCase() : "builder";
}

/**
 * Scaffold a start-work spec file from an issue card. H1 = issue title;
 * status line records the start-work source; Goal = issue body excerpt;
 * acceptance placeholders; tracker link to the issue.
 */
export function scaffoldSpecContent(issue: IssueCard): string {
  const title = issue.title.trim();
  const goal = (issue.bodyExcerpt ?? "").trim();
  const tracker = issue.url.trim() !== "" ? issue.url : `#${String(issue.number)}`;
  const lines = [
    `# ${title}`,
    "",
    `**Status:** Draft — start-work scaffold from #${String(issue.number)}.`,
    "",
    "## Goal",
    "",
    goal !== "" ? goal : "_No description provided in the issue._",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] TBD: confirm scope and expected outcomes from the issue discussion.",
    "- [ ] TBD: `npm run check` green in the worktree.",
    "",
    "## Tracker",
    "",
    `[#${String(issue.number)}](${tracker}) — ${title}`,
    "",
  ];
  return lines.join("\n");
}

/** Standard M4 dispatch acceptance text for a start-work unit. */
export function startWorkAcceptance(unitId: string, specPath: string): string {
  return [
    `Implement ${unitId} per ${specPath};`,
    "npm run check passes in the worktree;",
    "builder handoff present;",
    "QA (qa-tester) and review (pr-reviewer) handoffs before any PR/merge;",
    "three-way reconciliation (spec ↔ change ↔ tests) documented.",
  ].join(" ");
}
