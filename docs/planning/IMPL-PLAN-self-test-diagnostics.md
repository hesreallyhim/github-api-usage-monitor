# Implementation Plan: Self-Test Diagnostic Enhancements

**Branch:** `feat/self-test-diagnostics`
**Date:** 2026-01-29

## Goal

Two enhancements to the self-test workflow:
1. **Always-visible validation** — show pass/fail results in the step summary even when `strict_validation` is off (never silently skip)
2. **Diagnostic details disclosure** — `<details><summary>` per scenario with per-poll timeline, beginning/end values, window crossing context

## Key Constraint

The detailed per-poll data (timestamps, before/after values, window crossing events) does **not** exist in `state.json` today — the reducer is constant-space by design. We need a diagnostic poll log.

The spec already anticipated this: `"out_of_scope_steel_thread": ["Optional JSONL time series artifact"]` (`spec/spec.json:141`).

---

## Changes

### 1. Add poll log infrastructure (action code)

**New type** in `src/types.ts`:
```typescript
export interface PollLogEntry {
  timestamp: string;         // ISO
  poll_number: number;
  buckets: Record<string, PollLogBucketSnapshot>;
}

export interface PollLogBucketSnapshot {
  used: number;
  remaining: number;
  reset: number;
  limit: number;
  delta: number;
  window_crossed: boolean;
  anomaly: boolean;
}
```

Also add constant: `POLL_LOG_FILE_NAME = 'poll-log.jsonl'`

**New file** `src/poll-log.ts`:
- `appendPollLogEntry(entry: PollLogEntry): void` — append one JSON line to `$STATE_DIR/poll-log.jsonl`
- `getPollLogPath(): string` — resolves path via `getStateDir()`
- Append-only JSONL format (one JSON object per line, no array wrapping)

**Modify** `src/poller.ts` → `performPoll()`:
- After `reduce()`, build a `PollLogEntry` from `ReduceResult.updates` and write it via `appendPollLogEntry()`
- Poll number comes from `newState.poll_count`

**Add** `first_used` and `first_remaining` to `BucketState` in `src/types.ts`:
- Set in `initBucket()` in `src/reducer.ts`
- Preserved through all updates (spread operator already handles this)
- Gives us "beginning" values without parsing the log

**Update** `spec/spec.json` `BucketState.fields` to include the two new fields.

### 2. Diagnostic renderer script

**New file** `scripts/render-diagnostics.mjs` — standalone vanilla JS (ES module, runs with `node`):
- Reads `$STATE_DIR/state.json` and `$STATE_DIR/poll-log.jsonl`
- Accepts `$SCENARIO_NAME` env var for the `<summary>` label
- Outputs GitHub-flavored markdown to stdout with `<details>` wrapper
- Content per bucket:
  - Used (start) / Used (end) / Used in job / Remaining (start) / Remaining (end) / Windows crossed
- Poll timeline table: `| # | Time | Bucket | Used | Remaining | Delta | Event |`
- Window crossing detail: which poll numbers bracket the crossing, values before/after
- Writes nothing if poll-log.jsonl is missing (graceful degradation)
- No dependencies — uses only `node:fs` and `node:path`

This is modular and isolatable — the main action summary (`output.ts`) is unchanged.

### 3. Self-test generator changes (`scripts/generate-self-test.ts`)

**Modify validation step** (currently skipped unless `strict_validation == 'true'`):
- Remove the `if: inputs.strict_validation == 'true'` condition — always run
- Split into two behaviors:
  - Always: write validation results (pass/fail per bucket) to `$GITHUB_STEP_SUMMARY`
  - Only when `strict_validation == 'true'`: `sys.exit(1)` on failure
- Update inline Python to write a markdown section with pass/fail per assertion

**Add diagnostic details step** after validation:
- New step: `"Diagnostic details"` (always runs)
- Runs: `node scripts/render-diagnostics.mjs >> "$GITHUB_STEP_SUMMARY"`
- Env: `STATE_DIR`, `SCENARIO_NAME`

### 4. Rebuild and regenerate

- `npm run build:all` — rebundle all 4 entry points (poller changed)
- `npx tsx scripts/generate-self-test.ts` — regenerate `self-test.yml`
- Commit both `dist/` and `self-test.yml`

---

## Files modified

| File | Change |
|------|--------|
| `src/types.ts` | Add `PollLogEntry`, `PollLogBucketSnapshot`, `POLL_LOG_FILE_NAME`; add `first_used`/`first_remaining` to `BucketState` |
| `src/reducer.ts` | Set `first_used`/`first_remaining` in `initBucket()` |
| `src/poll-log.ts` | **New** — append/read poll log JSONL |
| `src/poller.ts` | Call `appendPollLogEntry()` after each `reduce()` |
| `src/paths.ts` | Add `getPollLogPath()` |
| `spec/spec.json` | Update `BucketState` fields |
| `scripts/render-diagnostics.mjs` | **New** — diagnostic markdown renderer (vanilla JS, no deps) |
| `scripts/generate-self-test.ts` | Always-run validation + diagnostic details step |
| `.github/workflows/self-test.yml` | **Regenerated** |
| `dist/**` | **Rebuilt** |

## Files NOT modified

| File | Reason |
|------|--------|
| `src/output.ts` | Main user-facing summary unchanged — diagnostics are isolated |
| `src/post.ts` | No changes to the action's post hook |

---

## Verification

1. `npm run typecheck` — no type errors
2. `npm test` — existing unit tests pass (reducer tests need update for new BucketState fields)
3. `npm run build:all` — bundles succeed
4. `npx tsx scripts/generate-self-test.ts` — regenerate without errors
5. Diff `self-test.yml` — validation step no longer has `if:` guard; new diagnostic step present
6. Manual check: run `STATE_DIR=test/fixtures node scripts/render-diagnostics.mjs` against a fixture state.json + poll-log.jsonl to verify markdown output
