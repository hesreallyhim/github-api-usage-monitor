# ADR-003: Declarative self-test generator

**Status:** Accepted
**Date:** 2026-01-29

## Context

The project's integration test is a GitHub Actions workflow (`.github/workflows/self-test.yml`) that exercises the monitor action against real GitHub API rate-limit buckets. Each scenario starts the monitor, makes known API calls, waits for the poller to observe them, then dumps `state.json` for inspection.

The original workflow was hand-written YAML. Every scenario required duplicating ~60 lines of identical job structure (checkout, start monitor, make calls, wait, dump state), differing only in which endpoints to hit, how many calls to make, and how long to observe. Adding or modifying a scenario meant editing deeply nested YAML with no type safety and no way to enforce structural consistency.

## Decision

Replace hand-written YAML with a **declarative generator**:

1. **`scripts/scenarios.ts`** defines each scenario as a typed data object (`Scenario` interface) specifying endpoints, call counts, sleep intervals, poll duration, and expected bucket deltas.
2. **`scripts/generate-self-test.ts`** reads the scenario list and produces the full workflow YAML, stamping out identical job structure per scenario.
3. **`.github/workflows/self-test.yml`** is generated output — never edited by hand.

Regenerate with:

```bash
npx tsx scripts/generate-self-test.ts
```

### Scenario structure

Each scenario declares:

- **Endpoints** to call (from a shared `ENDPOINTS` constant: core, search, code_search, graphql)
- **Call count** per endpoint
- **Inter-call sleep** (seconds between API calls)
- **Poll duration** (total observation window)
- **Expected bucket deltas** (`total_used_delta`, `windows_crossed_max`)

### Generated job shape

Every scenario produces the same job structure:

1. Checkout
2. Start monitor (`uses: ./`)
3. Execute API calls (generated curl loops)
4. Wait for remaining poll duration
5. Dump `state.json`
6. Validate assertions (conditional on `strict_validation` input)

Jobs are chained linearly via `needs:` to avoid concurrent rate-limit pool contamination.

### Validation toggle

The workflow exposes a `strict_validation` boolean input (default: `false`). When enabled, each job runs a Python assertion step that checks `state.json` values against expected deltas. Disabled by default because the `GITHUB_TOKEN` rate-limit pool is shared across all workflows in the repository, so `core` bucket measurements can include noise from concurrent CI activity.

## Consequences

### Positive

- **Adding a scenario** is a single object in `scenarios.ts` — no YAML duplication
- **Type safety** — TypeScript interfaces catch structural errors at generation time
- **Consistent structure** — impossible for one job to accidentally diverge from the pattern
- **Computed values** — remaining sleep time, curl templates, and validation scripts are derived from scenario data
- **Shared constants** — endpoint definitions live in one place

### Negative

- **Two-step edit** — changes to scenarios require running the generator before committing
- **Generated file in git** — `.github/workflows/self-test.yml` is checked in (GitHub requires it) but should not be hand-edited
- **No runtime dep** — the generator uses `tsx` which is a dev dependency; if removed, generation breaks

### Known limitations

- **Cross-workflow noise** — all jobs in a repo share the same `GITHUB_TOKEN` rate-limit pool. Concurrent workflows can inject noise into bucket measurements, particularly `core`. This is why `strict_validation` defaults to off.
- **A dedicated test repo** or reserved token would improve isolation but is not yet implemented.

## Alternatives considered

### Hand-written YAML (status quo)

Rejected — too much duplication, error-prone, no type checking. The 12-scenario suite would be ~1000 lines of repetitive YAML.

### YAML templating (e.g. GitHub Actions reusable workflows or composite actions)

Considered — reusable workflows can reduce duplication but don't provide type safety, computed values, or generation-time validation. Composite actions would help with individual steps but don't solve the job-level repetition.

### Runtime test framework (e.g. vitest integration tests)

Not applicable — the scenarios must run as GitHub Actions jobs to exercise the real action lifecycle (pre/main/post hooks, `$RUNNER_TEMP`, `$GITHUB_STEP_SUMMARY`). A test framework can't replicate that environment.
