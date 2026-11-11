/**
 * M4 skill catalog.
 *
 * A skill trigger prepares a bounded skill request that references the skill's
 * SKILL.md and the unit context. The queue entry is the same shape as a
 * dispatch entry plus `skill` and `contextRefs`. The Lead executes the skill by
 * delegating to the matching role agent — the control server never runs skills
 * or spawns agents.
 */

import type { Unit } from "../types.ts";

export interface SkillDef {
  id: string;
  label: string;
  /** Path to the skill's SKILL.md, relative to the repo root. */
  skillPath: string;
  /** Suggested agent definition (suggestion only). */
  role: string;
  eligible(unit: Unit): boolean;
  acceptance(unit: Unit): string;
  contextRefs(unit: Unit): string[];
}

function specPathOf(unit: Unit): string {
  return unit.specPath ?? `SPEC/${unit.id}.md`;
}

const QA_TESTER: SkillDef = {
  id: "qa-tester",
  label: "QA tester",
  skillPath: ".github/skills/qa-tester/SKILL.md",
  role: "qa-tester",
  eligible: (unit) => unit.flags.qaPending || unit.stage === "qa",
  acceptance: (unit) =>
    `Verify ${unit.id} per ${specPathOf(unit)} with real commands (npm run check plus focused tests) inside the worktree; report actual output; deliver a qa-tester handoff.`,
  contextRefs: (unit) => [specPathOf(unit), ".github/skills/qa-tester/SKILL.md"],
};

const PR_REVIEWER: SkillDef = {
  id: "pr-reviewer",
  label: "PR reviewer",
  skillPath: ".github/skills/pr-reviewer/SKILL.md",
  role: "pr-reviewer",
  eligible: (unit) => unit.flags.reviewPending || unit.stage === "review",
  acceptance: (unit) =>
    `Review the ${unit.id} diff against ${specPathOf(unit)} (read-only): correctness, contract compliance, mobile usability, multiplayer edge cases, regressions; deliver a pr-reviewer handoff with a verdict.`,
  contextRefs: (unit) => [specPathOf(unit), ".github/skills/pr-reviewer/SKILL.md"],
};

const OPEN_PR: SkillDef = {
  id: "open-pr",
  label: "Open PR",
  skillPath: ".github/skills/open-pr/SKILL.md",
  role: "builder",
  eligible: (unit) => unit.pr === undefined && unit.branch !== undefined,
  acceptance: (unit) =>
    `Open a PR for factory/${unit.id} → main using the open-pr skill (template body, QA + review handoffs present), then watch CI to completion; report the PR URL and final CI status.`,
  contextRefs: (unit) => [
    specPathOf(unit),
    ".github/skills/open-pr/SKILL.md",
    ".github/pull_request_template.md",
  ],
};

const SKILLS: readonly SkillDef[] = [QA_TESTER, PR_REVIEWER, OPEN_PR];

const SKILL_BY_ID: ReadonlyMap<string, SkillDef> = new Map(
  SKILLS.map((skill) => [skill.id, skill]),
);

export function skillById(id: string): SkillDef | undefined {
  return SKILL_BY_ID.get(id);
}

export function listSkills(): readonly SkillDef[] {
  return SKILLS;
}
