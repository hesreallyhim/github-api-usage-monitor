# GitHub Docs Watch Metadata

This directory stores **metadata only** for monitored GitHub documentation pages.

Copyright policy constraint: upstream GitHub documentation bodies are intentionally not committed in this public repository.

## Files

- `watch-list.json`: monitored pages and expected hashes (`redirect_link`, `content_sha256`).
- Upstream page Markdown files are intentionally not tracked.

## Private state (required for full diff + LLM review)

Readable diffs require a private local state directory that stores snapshot bodies outside this public repo.

Example local state location:

- `.tmp/docs-watch/state` (default for local scripts)
- For recurring local or automated runs, prefer a stable external path via
  `DOC_WATCH_STATE_DIR`, for example
  `$HOME/.local/state/github-api-usage-monitor/docs-watch`

## Local workflow

1. Recommended entrypoint: `npm run docs-watch:review`
2. If you are running manually and want explicit control:
   - first run or missing snapshots: `npm run sync:github-docs-state`
   - exact review run: `npm run docs-watch:local`
3. Ask Codex to review `.tmp/docs-watch/docs-watch-report.md` and classify project impact.

## Protocol notes

- If a run reports `status: bootstrap-required`, do not open or update a PR from
  that run alone.
- `bootstrap-required` means the manifest differs from current upstream docs, but
  there is no private baseline snapshot for at least one changed page, so the run
  cannot produce a reliable readable diff.
- After seeding private state with `npm run sync:github-docs-state`, rerun the
  exact review. Only act on a PR if that synced exact review still reports
  `changed: true`.

Outputs are written under `.tmp/docs-watch/` by default.
