# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A GitHub Action that monitors API rate-limit usage during a CI job by polling `/rate_limit` in a background process, then rendering a summary in the job's step summary. It uses a pre/post hook lifecycle — `pre.ts` starts the poller at job start, `main.ts` is a no-op, and `post.ts` kills the poller and writes the report.

## Commands

```bash
npm test                # Unit tests (vitest)
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage
npm run test:integration # Integration tests (builds poller first)
npm run test:all        # Unit + integration

npm run lint            # ESLint
npm run lint:fix        # ESLint with autofix
npm run format          # Prettier write
npm run format:check    # Prettier check
npm run typecheck       # tsc --noEmit

npm run build:all       # Bundle all 4 entry points with ncc
npm run build           # Bundle main only
npm run build:poller    # Bundle poller only (needed before integration tests)
```

Run a single test file: `npx vitest run test/reducer.test.ts`

Pre-commit hook runs: lint → format:check → test → build:all → verify dist/ is unchanged.

## Architecture

```
Entry points          pre.ts → start.ts (spawn poller)
                      main.ts (no-op)
                      post.ts (kill poller, render summary)
                          ↓
Poller layer          poller.ts (background process loop, adaptive scheduling)
                      poller-entry.ts (ESM entry for child process)
                          ↓
Core logic            reducer.ts (pure aggregation: initBucket, updateBucket, reduce)
                      state.ts (atomic JSON persistence, PID management, startup verification)
                          ↓
Infrastructure        github.ts (fetch /rate_limit with timeout + defensive parsing)
                      output.ts (markdown table + console summary + warnings)
                      paths.ts ($RUNNER_TEMP/github-api-usage-monitor/*)
                      platform.ts (linux/darwin supported, win32 rejected)
                      types.ts (all boundary types and constants)
```

The poller runs as a **detached child process** (spawned with `detached: true`, then `unref()`). Parent verifies startup by polling `state.json` for `poller_started_at_ts`. State is persisted atomically (write to `.tmp`, rename).

### Key design patterns

- **Pure functions for testability** — `reducer.ts` functions, `computeSleepPlan`, and `applyDebounce` are all stateless. Side effects live only in the loop and entry points.
- **Result discriminated unions** — I/O operations return `{ success: true, data } | { success: false, error }`.
- **Constant-space aggregation** — Reducer tracks O(#buckets) state, not O(#polls). No historical samples stored.
- **Adaptive polling** (ADR-002) — `computeSleepPlan` targets polls near bucket resets to minimize unobserved usage. `applyDebounce` floors all sleeps at 5s to prevent burst stacking from staggered resets.

### Build & bundling

Four separate ncc bundles, each from a different entry point:
- `src/main.ts` → `dist/main.js`
- `src/pre.ts` → `dist/pre.js`
- `src/post.ts` → `dist/post.js`
- `src/poller-entry.ts` → `dist/poller/index.js`

`dist/` is checked into git. CI verifies it stays up to date after `build:all`.

## TypeScript conventions

- Strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- Target ES2022, module ES2022, `moduleResolution: "bundler"`
- `@typescript-eslint/no-explicit-any: "error"` — no `any` allowed
- `@typescript-eslint/prefer-nullish-coalescing: "error"` — use `??` not `||`
- Prettier: single quotes, trailing commas, 100 char width, LF line endings

## Test conventions

- Vitest with globals enabled (`describe`, `it`, `expect` — no imports needed)
- Helper factories (`makeSample`, `makeBucket`, `makeState`) in test files for readable setup
- Integration tests have 30s timeout and 1 retry (process lifecycle tests are flaky)
- Fixtures in `test/fixtures/` — real API response shapes

## Self-test workflow (declarative generator)

The integration test suite at `.github/workflows/self-test.yml` is **generated**, not hand-written. Do not edit it directly.

```bash
npx tsx scripts/generate-self-test.ts   # regenerate self-test.yml
```

### How it works

- **`scripts/scenarios.ts`** — Declarative scenario definitions (12 scenarios). Each scenario specifies endpoints to call, call counts, sleep intervals, poll duration, and expected bucket deltas/window crossings.
- **`scripts/generate-self-test.ts`** — Generator that reads scenarios and stamps out identical job structure per scenario into the workflow YAML.
- **`.github/workflows/self-test.yml`** — Generated output. 12 jobs chained linearly via `needs:`. Trigger is `workflow_dispatch` only.

### Adding or modifying scenarios

1. Edit `scripts/scenarios.ts` — add/change scenario objects in the `SCENARIOS` array
2. Run `npx tsx scripts/generate-self-test.ts` to regenerate the workflow
3. Commit both `scenarios.ts` and `self-test.yml` together

### Validation

The workflow exposes a `strict_validation` input (default: `false`). When enabled, each job runs a Python assertion step that checks `state.json` against expected `total_used_delta` and `windows_crossed_max`. Currently off by default because cross-workflow noise from the shared `GITHUB_TOKEN` rate-limit pool can cause false positives on `core`.

### Design docs

- `docs/planning/IMPL-PLAN-declarative-self-test.md` — full design and rationale
- `docs/planning/github-rate-limit-buckets.md` — bucket reference (14 buckets, window sizes, testability)

## Key files for orientation

- `spec/spec.json` — authoritative specification (machine-readable)
- `HANDOFF.md` — project status, design decisions, known issues
- `docs/planning/ADR-*.md` — architecture decision records
- `action.yml` — GitHub Action definition (pre/main/post hooks)
