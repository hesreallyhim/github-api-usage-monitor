# HANDOFF — github-api-usage-monitor

**Date:** 2026-01-25
**Branch:** `build-spec`
**Status:** v1 implementation complete, ready for integration testing

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

- **67 tests passing** across 4 test files
- TypeScript: clean
- ESLint: clean
- Build: `dist/main.js` (991KB) + `dist/poller/index.js` (28KB)

---

## Architecture Summary

```
Workflow Step: start
    │
    ├── Validate platform (Linux/macOS only)
    ├── Initial poll to /rate_limit (fail-fast token validation)
    ├── Create initial state with baseline
    ├── Spawn detached poller process
    └── Write PID to $RUNNER_TEMP

Poller (background, every 30s)
    │
    ├── GET /rate_limit
    ├── Reduce: calculate deltas per bucket
    │   ├── Same window: delta = used - last_used
    │   ├── New window: total += used (post-reset)
    │   └── Anomaly: used decreased without reset
    └── Atomic write state.json

Workflow Step: stop (always)
    │
    ├── Kill poller by PID (SIGTERM)
    ├── Read final state
    ├── Generate warnings
    └── Render summary to $GITHUB_STEP_SUMMARY + console
```

---

## Key Design Decisions

1. **30s polling interval** — avoids missing 60s reset windows
2. **Fail-fast on start** — initial poll validates token before spawning poller
3. **Include post-reset `used`** — minimizes undercount at window boundaries
4. **Anomaly detection** — `used` decreasing without reset = warn, don't subtract
5. **ncc bundling** — `dist/main.js` + `dist/poller/index.js` as separate bundles

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

## Next Steps

1. **Integration test locally** — Run self-test workflow on a real GitHub runner
2. **Verify poller lifecycle** — Confirm detached process survives step boundaries
3. **Test edge cases**:
   - Token with no permissions
   - Very short job (< 30s)
   - Multiple window resets during job
4. **Consider adding**:
   - Debug log file for poller (currently silent)
   - `report_buckets` input for filtering output (v2)

---

## Outstanding Questions

1. **Poller log file** — Should the poller write debug logs to a file? Currently uses `stdio: 'ignore'`. Could add `$RUNNER_TEMP/github-api-usage-monitor/poller.log`.

2. **dist/ in repo** — Should `dist/` be committed to the repo (common for Actions) or generated on release? Currently gitignored.

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
