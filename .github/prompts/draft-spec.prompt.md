---
description: "Draft a concise implementation spec with acceptance criteria, edge cases, and validation for a project feature."
mode: agent
---

Draft a feature specification for: ${input:feature}

1. Read applicable `AGENTS.md` and Copilot instructions, then inspect the project brief, confirmed decisions, shared game contract, current implementation, and any existing specs related to this feature.
2. Keep confirmed rules distinct from proposals, assumptions, and open questions. Do not invent unresolved gameplay or protocol decisions. If an unresolved choice materially changes scope, call it out and ask before treating either option as the requirement.
3. Write a concise, implementation-ready draft with: user outcome; current behavior/context; scope and non-goals; functional requirements and rules; interfaces/data changes if relevant; edge cases and failure behavior; acceptance criteria; validation plan; dependencies; assumptions and open questions.
4. Ensure each acceptance criterion is observable and testable. Include mobile and multiplayer implications where relevant. Identify compatibility with the approved game contract or explain any conflict that requires a team decision.
5. Present the draft for review. Do not implement it, alter the decision log, or claim team approval. Do not write a repository file until the user approves the draft; then follow the existing spec location and format, or ask before establishing a new convention.