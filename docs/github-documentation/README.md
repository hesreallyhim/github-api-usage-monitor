# GitHub Docs Watch Metadata

This directory stores **metadata only** for monitored GitHub documentation pages.

Copyright policy constraint: upstream GitHub documentation bodies are intentionally not committed in this public repository.

## Files

- `rate-limit.md` and `rate-limits-for-the-rest-api.md`: frontmatter metadata (`redirect-link`, `content-sha256`) used for change detection.
- No upstream Markdown body text is stored here.

## Private state (required for full diff + LLM review)

Readable diffs require a private local state directory that stores snapshot bodies outside this public repo.

Example local state location:

- `.tmp/docs-watch/state` (default for local scripts)

## Local workflow

1. (Optional, first run) `npm run sync:github-docs-state`
2. `npm run check:github-docs`
3. `npm run diff:github-docs`
4. `npm run report:github-docs`
5. Ask Codex to review `.tmp/docs-watch/docs-watch-report.md` and classify project impact.

Outputs are written under `.tmp/docs-watch/` by default.
