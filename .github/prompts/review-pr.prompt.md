---
description: "Review a pull request or current branch diff for correctness, regressions, security, and missing tests."
mode: agent
---

Review this pull request or diff: ${input:target}

If the target is a PR number or URL, retrieve that PR's diff and relevant base-branch context using available GitHub tools. If it is omitted or identifies the current branch, review the current branch diff against its merge base. Do not create a PR, modify files, or submit/post a review.

Read applicable repository instructions and the relevant brief, decision log, game contract, feature spec, and tests. Review only the change unless an out-of-scope issue is a blocker. Prioritize correctness, security, async/state and multiplayer edge cases, mobile behavior, compatibility, and whether meaningful behavior changes have tests. Verify findings in the code; do not report speculative issues as facts.

Report findings first, ordered by severity. For each, include `[blocker]`, `[should]`, or `[nit]`, a concise explanation of impact, and a file/line reference. If there are no findings, say so explicitly and mention remaining test gaps or residual risks. Then include open questions or assumptions, followed by a brief summary and an `Approved`, `Changes requested`, or `Comment` verdict. Keep suggestions concrete and respectful.