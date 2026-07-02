# Maintainers

This file documents release and maintenance workflows for this repository.

## Release automation (Release Please)

- Workflow: `.github/workflows/release-please.yml`
- Trigger: manual run via `workflow_dispatch` (re-enable CI-triggered runs after history cleanup)
- Behavior: opens or updates a release PR and manages `CHANGELOG.md`
- Merge: merging the release PR creates the Git tag and GitHub Release
- Config: `release-please-config.json` and `.release-please-manifest.json` (tags and release titles are `vX.Y.Z`)


## Conventional Commits and PR titles

- Main branch uses a PR title lint (see `.github/workflows/semantic-pr.yml`).
- Squash-merge should use the PR title for the commit message to keep history linear.
- Maintainers may use any commit messages on feature branches; only the PR title must be Conventional Commits compliant.
- When time allows, keep commit messages conventional for clarity, but it is not required for merge.

### Dependabot guidance

- Dependabot PR titles are configured to use a Conventional Commit prefix (see `.github/dependabot.yml`).
- Maintainers must review dependency upgrades for breaking changes.
- If a dependency update is breaking, edit the PR title to include `!` (e.g., `chore(deps)!: bump react to v19`) or add a `BREAKING CHANGE:` note in the PR description.

## Release checklist


1. Ensure commit messages follow conventional commits:
   - `fix:` for patch releases
   - `feat:` for minor releases
   - `feat!:` or `BREAKING CHANGE:` for major releases
2. Verify `dist/` is up to date if any `src/` files changed since the last release:
   - run `npm run build:all`
   - if `dist/` changes, commit them to the release PR
   - CI also enforces this via the "Verify dist is up to date" step
3. Confirm CI is green on the release PR
4. Merge the release PR

## After merge

- Confirm the GitHub Release is published (not a draft)
- Verify the Marketplace listing reflects the new release tag/version

## Self-test workflows

The self-test workflows are used to validate the action's behavior against
controlled scenarios (no external traffic beyond the test runner). They run the
action in a matrix of scenarios, then download diagnostics artifacts and render
or validate detailed results. This is the fastest way to detect reducer
regressions and to verify the poller and post hook behave as expected.

### What they are

- Workflow files: `.github/workflows/self-test.yml.disabled` and `.github/workflows/realistic-test.yml.disabled`
- Generator: `scripts/generate-self-test.ts`
- Scenarios manifest: `scripts/scenarios.ts` (inputs) and `scripts/self-test-manifest.json` (generated)
- Scenario runner: `scripts/run-scenario.mjs`
- Validator: `scripts/validate-scenario.mjs`
- Diagnostics renderer: `scripts/render-diagnostics.mjs`

### How they are generated

- **Source of truth**: `scripts/scenarios.ts` defines all scenarios.
- Run `npm run generate:self-test` to regenerate:
  - `.github/workflows/self-test.yml.disabled`
  - `.github/workflows/realistic-test.yml.disabled` (only if realistic scenarios exist)
  - `scripts/self-test-manifest.json`
- Do not hand-edit the generated workflow files. The header in each workflow
  indicates they are auto-generated.

### When and why to run

- `self-test.yml.disabled` preserves the shorter controlled regression scenarios
  for reducer logic, polling behavior, state handling, and output formatting.
- `realistic-test.yml.disabled` preserves the longer-duration, production-like
  traffic pattern as an inactive workflow. Re-enable it only for deliberate
  soak-test work or after adding assertions that make it useful as a CI signal.
- Both workflows require `diagnostics: true` so they can download and analyze
  the diagnostics artifact. This is handled in the generator.

### Scenario selection

- Scenarios are toggled by workflow inputs (e.g., `run_core_5: true`).
- The generated workflows avoid inline `matrix.include` conditionals; toggles
  are checked by `scripts/check-scenario-enabled.mjs` at runtime.
- Diagnostics jobs skip when the paired scenario job is skipped.

### Notes

- Diagnostics artifacts include `state.json` and `poll-log.json`.
- If diagnostics are disabled in the action input, the self-test diagnostics
  jobs will not have artifacts to download and will fail.

## Docs-watch maintenance

The docs-watch process is local-only and intended for maintainers.

- Do not store upstream GitHub documentation bodies in this public repository.
- Monitored metadata lives in `docs/github-documentation/watch-list.json`.
- Local private state defaults to `.tmp/docs-watch/state` and stores snapshots
  used for diffing.
- For recurring runs, prefer a stable private path outside the worktree via
  `DOC_WATCH_STATE_DIR` so snapshots survive `.tmp/` cleanup and worktree churn.
- If remote snapshots and readable diff artifacts also need to stay outside the
  worktree, set `DOC_WATCH_REMOTE_DIR` and `DOC_WATCH_REVIEW_DIR` to private
  paths under the same state root.

### Local commands

- Seed or refresh baseline snapshots:
  - `npm run sync:github-docs-state`
- Bootstrap-aware review entrypoint (recommended):
  - `npm run docs-watch:review`
- Run check + diff + report (standard weekly run):
  - `npm run docs-watch:local`
- Individual steps:
  - `npm run check:github-docs`
  - `npm run diff:github-docs`
  - `npm run report:github-docs`

### Run artifacts

- Check payload: `${DOC_WATCH_REVIEW_DIR:-.tmp/docs-watch}/docs-check.json`
- Unified diff markdown: `${DOC_WATCH_REVIEW_DIR:-.tmp/docs-watch}/docs-diff.md`
- Unified diff patch: `${DOC_WATCH_REVIEW_DIR:-.tmp/docs-watch}/docs-diff.patch`
- Always-on run report (generated every run): `${DOC_WATCH_REVIEW_DIR:-.tmp/docs-watch}/docs-watch-report.md`

### Maintainer review loop

1. Prefer `npm run docs-watch:review` (or let weekly Codex automation use the
   same protocol).
2. Review the generated `docs-watch-report.md` for correctness.
3. If the report status is `bootstrap-required`, do not open or update a PR from
   that run. Seed private state with `npm run sync:github-docs-state`, then rerun
   the exact review.
4. Only if the synced exact review still reports `changed: true`, validate impact
   classification and decide if project updates are required.
5. If required, open/update a draft fix PR with project and metadata changes
   only.

### Recommended protocol

1. Set a stable private state directory, for example:
   - `export DOC_WATCH_STATE_DIR="$HOME/.local/state/github-api-usage-monitor/docs-watch"`
   - `export DOC_WATCH_REMOTE_DIR="$DOC_WATCH_STATE_DIR/remote"`
   - `export DOC_WATCH_REVIEW_DIR="$DOC_WATCH_STATE_DIR/review"`
2. Run `npm run docs-watch:review`.
3. Treat the first seeded run as bootstrap, not as a source of patch review.
4. Only create PRs from an exact synced run with `changed: true`.

## Notes

- `CHANGELOG.md` is generated by Release Please; avoid manual edits.
- If no release PR is created, confirm there are new conventional commits since the last tag.
- If Release Please fails to create a release, check tag rulesets for blocked tag creation or required status checks on tags.
