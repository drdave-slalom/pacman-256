---
description: "Deeply research and compare options for a product, technical, or workflow decision using current evidence."
mode: agent
---

Evaluate options for this decision: ${input:decision}

Do deep research before recommending a path:

1. Clarify the desired outcome, constraints, decision owner, and evaluation criteria from the request and repository context. Ask a concise follow-up only if a missing constraint could materially change the recommendation.
2. Inspect relevant project documents and code. Treat the brief and confirmed decision log as authoritative for product direction; distinguish confirmed decisions from proposals and open questions.
3. Research current external facts using available web/search tools. Prefer primary sources such as official documentation, standards, release notes, and pricing pages. Cite the source URL and publication/access date for material claims. If current research tools are unavailable, say so and do not present time-sensitive assumptions as verified facts.
4. Compare a small, relevant set of options against explicit criteria. Cover meaningful trade-offs such as fit, cost, complexity, reliability, security/privacy, maintenance, and reversibility where applicable. Separate evidence, assumptions, and unknowns.
5. Recommend an option with concise reasoning, identify what would change the recommendation, and list follow-up questions or validation steps. Do not implement the recommendation, change project decisions, or record a proposal as approved.

Keep the result decision-oriented: recommendation first, then comparison and evidence, then risks and next steps. Avoid broad background material that does not affect the choice.