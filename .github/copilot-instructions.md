# Copilot Instructions

## Shared project memory

- Read the [project brief](../PROJECT-BRIEF.md) for product direction and
  [decision log](../docs/DECISIONS.md) for confirmed rules, superseded decisions,
  and open questions before proposing architecture or behavior.
- The [delivery plan](../DELIVERY-PLAN.md) contains draft estimates and historical
  proposals. Confirmed, non-superseded decision-log entries take precedence.
- Record team-approved decisions and noteworthy context in the decision log;
  reconcile affected brief/spec/plan sections. Never record a proposal as approved.
- Use local-server and phone-network validation before cloud deployment.
  Roles are flexible; agree a task owner and shared-contract owner before parallel work.
- Planning/discussion alone does not authorize implementation. Do not invent
  unresolved game rules or build/test commands; check the current repo and ask.
- Shared memory reaches teammates only after normal review, commit, and push;
  never claim local edits are already shared.

## Base guidance

**Tool:** GitHub Copilot
**Version:** 2025-01
**Category:** Base Template
**Purpose:** Minimal starting point for `.github/copilot-instructions.md`

> This file provides a bare minimum set of common best practice instructions for GitHub Copilot. Copy this to your project's `.github/copilot-instructions.md` and customize as needed.

---

## Communication Style

Use a professional, direct communication style in all code suggestions and comments.

Focus on technical accuracy. Be concise and to the point.

Add comments only when code intent is not self-evident. Explain "why" in comments, not "what".

## Code Quality

Always prefer editing existing files over creating new ones.

Generate code that handles edge cases and error conditions appropriately.

Use clear, descriptive names for variables, functions, and classes.

Match existing code patterns and conventions in the project.

Remove unused code and imports from suggestions.

## Error Handling

Handle errors at the appropriate level with useful error messages.

Validate inputs early and fail fast for invalid state.

Don't swallow errors silently.

## Security

Never include secrets, API keys, or credentials in generated code.

Validate and sanitize user input.

Use parameterized queries to prevent SQL injection.

## Testing

Suggest tests for new features, bug fixes, complex logic, and public APIs.

Ensure tests are focused, independent, readable, and deterministic.

## Formatting

Follow the project's existing style guide and automated formatters.

Never include trailing spaces or tabs in blank lines.

---

## Customization Guide

To customize this template for your project:

1. **Add project-specific patterns** - Document architectural decisions, preferred libraries, or naming conventions
2. **Include technology-specific rules** - Add language or framework-specific guidance
3. **Reference documentation** - Link to team standards, style guides, or architecture docs
4. **Define review standards** - Specify what should be checked before suggesting code

For path-specific instructions, create `.github/instructions/*.instructions.md` files with YAML frontmatter:

```yaml
---
applyTo: "**/*.ts"
---

# TypeScript-specific instructions here
```

## Related Files

For more comprehensive guidance, see:
- `./communication.instructions.md` - Detailed communication rules
- `./code-quality.instructions.md` - Comprehensive code quality standards
- `./source-control.instructions.md` - Git and version control practices
- `../tech/*.instructions.md` - Technology-specific rules
