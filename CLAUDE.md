# CLAUDE.md

Read `.github/copilot-instructions.md` for all project conventions, structure, and rules.

## Behavior

- Match the author's conversational, first-person writing style — personal, technically deep, accessible
- Posts are bilingual (English or Bangla); respect whichever language the user writes in
- Never modify vendored files under `assets/lib/`
- Use existing tags and categories before inventing new ones
- Follow Chirpy theme conventions; don't duplicate gem-provided layouts/includes locally

## Conditional Instructions

See `.github/instructions/*.instructions.md` for domain-specific rules (posts, tabs).
These apply automatically based on `applyTo` globs when editing matching files.
