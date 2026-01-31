# HANDOFF — github-api-usage-monitor

**Date:** 2026-01-31
**Branch:** `claude`
**Status:** v1 implementation complete, self-test suite operational, code review fixes applied

---

## What Was Built

A GitHub Action that monitors API rate-limit usage during a workflow job by polling `/rate_limit` at 30-second intervals.

### Commits on `build-spec`

1. `838945c` — spec.json + derived artifacts (SPEC.md, mapping report, diagrams)
2. `c36cfb4` — full project scaffold from spec (24 files)
3. `266b26e` — core implementation (reducer, github client, main entry)

### Implementation Status

| Module | File | Status |
|--------|------|--------|
| Types | `src/types.ts` | Complete |
| Paths | `src/paths.ts` | Complete |
| Platform | `src/platform.ts` | Complete |
| State | `src/state.ts` | Complete |
| GitHub Client | `src/github.ts` | Complete |
| Reducer | `src/reducer.ts` | Complete |
| Output | `src/output.ts` | Complete |
| Poller | `src/poller.ts` | Complete |
| Main Entry | `src/main.ts` | Complete |

### Test Status

- **128 tests passing** across 6 test files
- TypeScript: clean (strict mode)
- ESLint: clean (`no-explicit-any` enforced)
- Build: 4 ncc bundles — `dist/main.js`, `dist/pre.js`, `dist/post.js`, `dist/poller/index.js`

---

## Architecture Summary

```
pre.ts → start.ts (action.yml pre hook)
    │
    ├── Validate platform (Linux/macOS only)
    ├── Initial poll to /rate_limit (fail-fast token validation)
    ├── Create initial state with baseline
    ├── Spawn detached poller process
    ├── Write PID to $RUNNER_TEMP
    └── Verify poller startup (poll state.json for poller_started_at_ts)

Poller (detached child process, adaptive interval)
    │
    ├── GET /rate_limit
    ├── Reduce: calculate deltas per bucket
    │   ├── Same window: delta = used - last_used
    │   ├── New window: total += used (post-reset)
    │   └── Anomaly: used decreased without reset
    ├── Atomic write state.json
    └── Append to poll-log.jsonl (diagnostic JSONL log)

main.ts (no-op, required by action.yml)

post.ts (action.yml post hook, runs always)
    │
    ├── Kill poller by PID (SIGTERM → SIGKILL escalation)
    ├── Perform final API poll
    ├── Read final state
    ├── Generate warnings
    ├── Render summary to $GITHUB_STEP_SUMMARY + console
    └── Expose state_json and poll_log_json as action outputs
```

---

## Key Design Decisions

1. **30s base polling interval** — avoids missing 60s reset windows
2. **Adaptive polling with pre-reset targeting** — instead of fixed 30s sleeps, the poller schedules polls to land ~3s before bucket resets, reducing the uncertainty window from ~50% to ~5% of a 60s bucket. Enters "burst mode" near resets: two polls bracket the reset boundary to capture both pre-reset and post-reset state. See [ADR-002](docs/planning/ADR-002-adaptive-polling.md).
3. **Poll debounce (5s floor)** — prevents rapid-fire polling when multiple short-window buckets have staggered resets. Applied as a separate layer after the adaptive sleep plan. Each post-reset poll already captures pre-reset state for nearby buckets, so back-to-back bursts are wasteful and naturally collapse under the debounce.
4. **Optimization ceiling acknowledged** — the ~3-5s residual uncertainty is fundamental: polling a REST endpoint can't do better without a push-based data source or intercepting outbound API calls. Further poll-scheduling refinement would yield negligible returns.
5. **Fail-fast on start** — initial poll validates token before spawning poller
6. **Include post-reset `used`** — minimizes undercount at window boundaries
7. **Anomaly detection** — `used` decreasing without reset = warn, don't subtract
8. **ncc bundling** — `dist/main.js` + `dist/poller/index.js` as separate bundles

---

## Files to Know

| Path | Purpose |
|------|---------|
| `spec/spec.json` | Authoritative specification |
| `SPEC.md` | Human-readable derived spec |
| `DESIGN-github-api-usage-monitor.md` | Original design doc |
| `action.yml` | GitHub Action definition |
| `src/reducer.ts` | Core algorithm (lines 72-131) |
| `test/reducer.test.ts` | Table-driven reducer tests |

---

## Self-Test Integration Suite

A declarative generator produces `.github/workflows/self-test.yml` from scenario definitions in `scripts/scenarios.ts`. The generator (`scripts/generate-self-test.ts`) stamps out 12 jobs covering core, search, code_search, and graphql buckets with patterns including burst, idle, window crossing, mixed, and sequential calls. Regenerate with `npx tsx scripts/generate-self-test.ts`.

Validation is toggleable via `strict_validation` input (default off) — assertions check `state.json` against expected deltas but are noisy due to cross-workflow rate-limit pool sharing.

**Known limitation:** All jobs in a repo share the same `GITHUB_TOKEN` rate-limit pool, so concurrent workflows can inject noise into `core` bucket measurements. A dedicated test repo or reserved token would improve isolation.

See `docs/planning/IMPL-PLAN-declarative-self-test.md` for full design.

## Next Steps

1. **Write README.md** — Usage examples, inputs/outputs reference, example summary output
2. **Increase test coverage** — poller lifecycle (20%), post.ts (0%), pre.ts (0%), poll-log.ts (0%)
3. **Consider test isolation** — Dedicated repo or reserved token to avoid cross-workflow rate-limit noise
4. **Consider adding**:
   - `report_buckets` input for filtering output (v2)
   - Threshold-based alerting (warn/fail when usage exceeds percentage)

---

## Resolved Questions

1. **Poller log file** — Resolved: poller writes diagnostic JSONL to `$RUNNER_TEMP/github-api-usage-monitor/poll-log.jsonl` via `poll-log.ts`. Exposed as `poll_log_json` action output.

2. **dist/ in repo** — Resolved: `dist/` is committed to git. Pre-commit hook verifies it stays in sync after `build:all`. CI also verifies.

---

## How to Test

```bash
# Install deps
npm install

# Run tests
npm test

# Typecheck + lint
npm run typecheck && npm run lint

# Build
npm run build:all

# Verify build output
ls -la dist/main.js dist/poller/index.js
```

---

## Clarifications Received

From user during this session:
- All buckets tracked; user specifies which to report (v1: all with usage)
- Initial poll on startup (fail-fast token validation)
- 30s interval (not 60s) to avoid missing resets
- Periodic state writes for durability
- ncc for bundling
- Fail early on initial poll failure

---

**End of handoff**
