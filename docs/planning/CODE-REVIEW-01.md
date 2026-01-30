# Code Review: fb43f94

**Commit:** `fb43f94` -- "feat: add poll log, always-visible validation, and diagnostic details to self-test"
**Reviewer:** Claude Opus 4.5 (automated review)
**Date:** 2026-01-29
**Scope:** All files changed in the commit, with focus on logical correctness, data flow, generated YAML, the diagnostic renderer, and the validation step changes.

---

## CRITICAL ISSUES

### 1. Validation step crashes on missing `state.json`, failing the job even in non-strict mode

**File:** `scripts/generate-self-test.ts`, lines 112-116 (generated Python)
**Manifests in:** `.github/workflows/self-test.yml`, every validation step (e.g. lines 94-99 in the `core-5` job)

The validation step was changed from conditional (`if: inputs.strict_validation == 'true'`) to unconditional. The generated Python script opens `state.json` with a bare:

```python
with open(state_path) as f:
    state = json.load(f)
```

If `state.json` does not exist (poller failed to start, runner temp was cleaned, etc.), this raises an unhandled `FileNotFoundError`. Python exits with a non-zero code, which fails the step and the job -- **regardless of whether `strict_validation` is enabled**.

This directly contradicts the stated intent at line 109 of `generate-self-test.ts`: "Only exits non-zero when `$STRICT_VALIDATION == 'true'`."

**Impact:** Any poller startup failure will cause job failure in non-strict mode. Since `strict_validation` defaults to `false`, this is the default behavior for all workflow dispatches.

**Fix:** Wrap the file read in a try/except. On `FileNotFoundError`, write a "state.json not found" summary to `$GITHUB_STEP_SUMMARY`, then only `sys.exit(1)` if strict mode is enabled. Example:

```python
if not os.path.exists(state_path):
    msg = '### Validation: SKIP\n\nstate.json not found -- poller may not have started.\n'
    print(msg)
    if summary_path:
        with open(summary_path, 'a') as f:
            f.write(msg)
    if strict:
        sys.exit(1)
    sys.exit(0)
```

### 2. Anomaly path in `updateBucket` does not explicitly set `first_used`/`first_remaining`

**File:** `src/reducer.ts`, lines 135-150

The anomaly branch uses `...bucket` spread to construct the new bucket state:

```typescript
return {
  bucket: {
    ...bucket,
    last_used: sample.used,
    anomalies: bucket.anomalies + 1,
    last_seen_ts: timestamp,
    limit: sample.limit,
    remaining: sample.remaining,
  },
  delta: 0,
  anomaly: true,
  window_crossed: false,
};
```

This works **today** because `...bucket` carries forward `first_used` and `first_remaining`. However, the other two branches (window crossing at lines 88-105 and reset-rotation at lines 111-129) explicitly set these fields. The anomaly branch is the only one relying on implicit spread preservation.

**Impact:** A future refactoring that replaces the spread with explicit field assignment (for consistency with the other branches) would silently drop the new fields. There are zero tests for `first_used`/`first_remaining` in the test suite (confirmed by searching `test/` -- no matches), so this regression would go undetected.

**Fix:** Explicitly set `first_used: bucket.first_used` and `first_remaining: bucket.first_remaining` in the anomaly branch for consistency with lines 99-100 and 123-124. Add unit tests for `first_used`/`first_remaining` preservation across all `updateBucket` paths, including the anomaly case.

---

## MAJOR CONCERNS

### 3. Validation step lacks `if: always()`, so it is silently skipped when prior steps fail

**File:** `scripts/generate-self-test.ts`, lines 222-232
**Manifests in:** `.github/workflows/self-test.yml`, e.g. the `core-5` job, line 89

The "Validate expectations" step has no `if:` condition, using the default behavior: skip if any prior step failed. The "Diagnostic details" step (line 238) has `if: always()`.

If the scenario curl step or the wait step fails (network error, timeout, etc.), the validation step is skipped entirely -- no validation summary is written to `$GITHUB_STEP_SUMMARY`. Only the diagnostic details step runs.

This is inconsistent: the stated goal of this commit is "always-visible validation," but the validation step itself is not always-visible.

**Recommendation:** Add `if: always()` to the validation step at line 222 of `generate-self-test.ts`. The Python script already needs the `FileNotFoundError` guard from Issue #1 above to handle this case gracefully.

### 4. "Used (start)" vs "Used (end)" column semantics break down across window crossings

**File:** `scripts/render-diagnostics.mjs`, lines 76-93

The bucket summary table shows:

| Column | Source field | Meaning |
|--------|-------------|---------|
| Used (start) | `bucket.first_used` | Raw `used` counter at first observation |
| Used (end) | `bucket.last_used` | Raw `used` counter at last observation |
| Used in job | `bucket.total_used` | Accumulated delta across all polls |

When a window crossing occurs, `last_used` resets to a small number (the post-reset usage). This means `Used (end)` can be **less than** `Used (start)`, and the relationship `Used (end) - Used (start) = Used in job` does not hold.

For example: if `first_used=10`, a window crosses, and `last_used=3`, the table shows:

```
| core | 10 | 3 | 15 | ... |
```

A reader would expect 15 = 3 - 10, but 15 is actually the correct accumulated total. The column names are misleading.

**Recommendation:** Either rename "Used (start)" and "Used (end)" to "API used counter (first poll)" and "API used counter (last poll)" to clarify these are raw API values, or add a markdown note below the table: "Note: 'Used' columns show the raw API counter, which resets on window boundaries. 'Used in job' is the accumulated total."

### 5. Zero test coverage for `first_used` and `first_remaining` fields

**File:** All files under `test/` -- no matches for `first_used` or `first_remaining`

These fields are new additions to `BucketState`, set in `initBucket()` (line 65 of `src/reducer.ts`) and preserved through `updateBucket()`. They are consumed by `render-diagnostics.mjs` (line 88-89).

There are no unit tests that:
- Verify `initBucket()` sets `first_used` and `first_remaining` to the initial sample values
- Verify `updateBucket()` preserves them through normal deltas, window crossings, reset rotations, and anomalies
- Verify test factories (`makeBucket`) include the new fields

**Impact:** Any regression in field initialization or preservation will go undetected by the test suite. The existing 123 tests all pass because they use patterns (spread, partial matching) that don't check for these fields.

---

## IMPROVEMENTS NEEDED

### 6. `STRICT_VALIDATION` env var receives empty string for boolean `false`, not the string `'false'`

**File:** `scripts/generate-self-test.ts`, line 225
**Generated YAML:** `.github/workflows/self-test.yml`, e.g. line 92

The workflow input `strict_validation` is declared as `type: boolean` (line 12 of `self-test.yml`). In GitHub Actions, `${{ inputs.strict_validation }}` evaluates to the string `'true'` when the input is true, and to an **empty string** `''` when false.

The Python code at generated line 98:

```python
strict = os.environ.get('STRICT_VALIDATION', 'false') == 'true'
```

This works by coincidence: `'' == 'true'` is `False`. But the default value `'false'` in `os.environ.get('STRICT_VALIDATION', 'false')` is dead code -- the env var is always set in the YAML, it is just empty. The code reads as if `'false'` is a meaningful fallback, which is misleading.

**Recommendation:** Change to `os.environ.get('STRICT_VALIDATION', '') == 'true'` for clarity, or add a comment explaining the empty-string behavior.

### 7. `formatTime` number branch in `render-diagnostics.mjs` is dead code

**File:** `scripts/render-diagnostics.mjs`, lines 55-62

`formatTime` handles both numbers and strings, but every call site passes an ISO string (`entry.timestamp`). The number branch (lines 56-57) is never executed. A separate `formatResetEpoch` function (lines 64-66) handles the epoch-to-string conversion.

The number branch also uses `.replace('.000Z', ' UTC')` which would silently produce wrong output if called with a non-integer epoch (the `.000Z` would not match).

**Recommendation:** Remove the number branch from `formatTime` and rely on `formatResetEpoch` for epoch values. Alternatively, rename `formatTime` to `formatISOTimestamp` to clarify its expected input.

### 8. Generator does not escape `SCENARIO_NAME` for YAML safety

**File:** `scripts/generate-self-test.ts`, line 241

```typescript
lines.push(`      SCENARIO_NAME: "${scenario.name}"`);
```

The scenario name is inserted into a YAML double-quoted string with zero escaping. Current scenario names contain em-dashes and plus signs, which are safe. But if a future scenario name contained a double quote (`"`), backslash (`\`), or YAML flow indicator, the generated YAML would be syntactically broken.

**Recommendation:** Escape the scenario name for YAML double-quoted strings, or use a YAML library for generation. At minimum, replace `"` with `\"` and `\` with `\\` in the scenario name.

### 9. Poll log is not written for failed polls, creating invisible gaps in diagnostics

**File:** `src/poller.ts`, lines 375-378

When `fetchRateLimit` fails, `performPoll()` calls `recordFailure()` and returns early without appending to the poll log. Failed polls are invisible in the diagnostic timeline. The metadata section shows `poll_failures` count, but there is no way to determine **when** failures occurred from the diagnostics.

**Recommendation:** Append a log entry for failed polls as well, with a distinguishing field (e.g., `"error": true`, `"buckets": {}`). This would make the timeline complete and allow correlation of failure timing with other events.

### 10. Interesting-row filter in poll timeline hides steady-state polls

**File:** `scripts/render-diagnostics.mjs`, lines 129-135

The timeline only shows a bucket row if `poll_number === 1`, `delta > 0`, `window_crossed`, or `anomaly`. Steady-state polls where nothing changed are completely hidden. This is a reasonable brevity trade-off for normal operation, but when debugging timing issues (e.g., "was the poller actually running during this 60-second window?"), the absence of quiet polls is unhelpful.

**Recommendation:** Add a summary row for quiet polls, such as "polls 3-7: no activity" between interesting rows, so the reader can confirm the poller was alive during gaps.

---

## Summary

| Severity | Count | Key items |
|----------|------:|-----------|
| Critical | 2 | Validation crashes on missing state.json; anomaly path relies on implicit spread |
| Major | 3 | Validation step not `always()`, misleading column names, zero test coverage for new fields |
| Improvement | 5 | Dead code, missing escaping, diagnostic gaps |

The most urgent fix is Issue #1: the validation step will fail non-strict workflow runs whenever the poller does not produce `state.json`. This is a functional regression from the previous behavior where the step was skipped entirely in non-strict mode.
