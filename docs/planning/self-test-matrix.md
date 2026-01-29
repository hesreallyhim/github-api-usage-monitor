# Self-Test Integration Matrix & Predicted Results

> Created: 2026-01-29
> Context: Reducer fix for idle window expiry (commit 327a0a4)

## Purpose

The self-test workflow (`.github/workflows/self-test.yml`) runs targeted jobs that make
known quantities of API calls against specific rate-limit buckets. By comparing the
monitor's reported `total_used` against the expected call count, we validate that the
reducer is counting correctly.

Each job dumps `state.json` both via a shell step (before the post hook) and via debug
logging in `post.ts` (after the final poll). Poll interval is 30s.

---

## Open Question: Infrastructure Noise Floor

Previous self-test runs showed `core` reporting 9 `total_used` when only 5 explicit
`GET /repos/{owner}/{repo}` calls were made. The 4 extra could come from:

| Hypothesis | Source | Expected baseline `total_used` |
|------------|--------|-------------------------------|
| A | `actions/checkout@v4` makes ~4 REST API calls | ~4 |
| B | `GET /rate_limit` counts against `core` (poll_count polls + 1 final) | ≈ poll_count + 1 |
| C | Combination of A and B | ~4 + poll_count + 1 |

**The baseline job disambiguates.** It makes zero explicit API calls, so whatever
`core.total_used` reports is pure infrastructure noise.

### How to read baseline results

- If `total_used = 0` → checkout and `/rate_limit` don't count → the previous 9 is unexplained
- If `total_used ≈ poll_count + 1` → `/rate_limit` counts against core (hypothesis B)
- If `total_used > 0` but `≠ poll_count + 1` → checkout/infra makes REST calls (hypothesis A or C)

Once we know the baseline, define: **`B = baseline total_used`** for subsequent predictions.

---

## GitHub Rate-Limit Window Mechanics (Reference)

Each bucket has:
- `limit`: max requests per window
- `used`: cumulative requests consumed since window start
- `remaining`: `limit - used`
- `reset`: unix timestamp = `first_use_in_window + window_duration`

| Bucket | Window duration | Limit |
|--------|----------------|-------|
| `core` | 60 min | 5000 |
| `search` | 60 sec | 30 |
| `graphql` | 60 min | 5000 |
| Others | 60 min or 60 sec | Various |

For a bucket with **0 usage**, `reset ≈ now + window_duration` (no anchor). When that
window expires, a new one starts: `reset` jumps forward, `used` stays 0. The reducer
must treat this as a no-op, not a "window crossing."

For a bucket with **actual usage**, a genuine reset means `used` drops (e.g. 150 → 3).
The `used < last_used` check catches this.

---

## Self-Test Job Matrix

All targeted jobs run sequentially via `needs:` to avoid cross-job token contamination.
Platform tests (macOS, Windows) run in parallel after `build-check`.

| # | Job name | Duration | Explicit API calls | Target bucket | Expected `total_used` | What it proves |
|---|----------|----------|--------------------|---------------|----------------------|----------------|
| 1 | `baseline` | 90s (~3 polls) | **None** | core | Unknown → **B** | Infrastructure noise floor; whether `/rate_limit` and checkout count |
| 2 | `test-core-5` | 90s (~3 polls) | 5× `GET /repos/{owner}/{repo}` | core | **B + 5** | Delta counting works for core bucket |
| 3 | `test-core-10` | 90s (~3 polls) | 10× `GET /repos/{owner}/{repo}` | core | **B + 10** | Confirms linear scaling |
| 4 | `test-search` | 90s (~3 polls) | 3× `GET /search/repositories?q=test` | search | **3** (no baseline noise expected) | Search bucket (60s window) counting; may see genuine window crossing if calls span >60s |
| 5 | `test-graphql` | 90s (~3 polls) | 2× `POST /graphql { query: "{ viewer { login } }" }` | graphql | **2** (no baseline noise expected) | GraphQL bucket counting works |
| 6 | `test-mixed` | 120s (~4 polls) | 5× core + 3× search + 2× graphql | all three | core: **B + 5**, search: **3**, graphql: **2** | Multi-bucket end-to-end |

### Notes on predictions

- **B (baseline)** is measured, not assumed. All core predictions depend on it.
- Search and graphql buckets should have no infrastructure noise because `GET /rate_limit`
  and `actions/checkout` are REST (core) operations.
- The search bucket has a 60-second window. If the 3 search calls span >60s, we may see
  a genuine window crossing (`windows_crossed = 1`), but `total_used` should still be 3.
- Poll count depends on timing: 90s ÷ 30s = ~3 polls, plus the final poll in `post.ts`.

---

## What to Check in Each Job's Output

### From the "Dump state.json" step (shell, before post hook)

```
STATE_FILE="${RUNNER_TEMP}/github-api-usage-monitor/state.json"
```

Look for:
- `poll_count` — how many polls completed
- Per target bucket: `total_used`, `windows_crossed`, `last_used`, `last_reset`

### From post.ts debug logging (after final poll)

```
--- Debug: per-bucket state ---
Poll count: N | Failures: M
  core: used=X, last_used=X, total_used=Y, windows_crossed=Z, ...
--- End debug ---
```

### Validation checklist per job

- [ ] `total_used` matches prediction (within ±1 for timing edge cases)
- [ ] `windows_crossed = 0` for core and graphql (60-min windows, job is <2 min)
- [ ] `windows_crossed ≤ 1` for search (60-sec window, calls may span a boundary)
- [ ] `poll_failures = 0`
- [ ] `anomalies = 0`
- [ ] Idle buckets (e.g. `scim`, `audit_log`) show `total_used = 0` and do NOT appear in the summary table

---

## Idle Bucket Behavior (What the Reducer Fix Addresses)

Before the fix, idle buckets would show `windows_crossed > 0` because the reducer treated
any `reset` timestamp change as a window crossing. In reality, idle buckets rotate their
`reset` timestamp every window period without any usage occurring.

**After the fix:**
- `resetChanged && usedDecreased` → genuine crossing (used dropped after real usage)
- `resetChanged && !usedDecreased` → idle rotation or continued usage; compute delta only
- Idle bucket with `used=0 → used=0` across reset change → `delta=0`, no crossing

The unit tests in `test/reducer.test.ts` (scenarios 1–7 in the "idle window expiry"
describe block) verify all combinations.

---

## Results Log

Record actual results here after each workflow run.

### Run 1: TBD

- **Date:** _pending push_
- **Workflow run:** _link_
- **Baseline `total_used` (B):** _TBD_
- **Hypothesis confirmed:** _TBD_

| Job | Expected `total_used` | Actual `total_used` | `windows_crossed` | Pass? |
|-----|----------------------|--------------------|--------------------|-------|
| baseline | B | | | |
| test-core-5 | B + 5 | | | |
| test-core-10 | B + 10 | | | |
| test-search | 3 | | | |
| test-graphql | 2 | | | |
| test-mixed (core) | B + 5 | | | |
| test-mixed (search) | 3 | | | |
| test-mixed (graphql) | 2 | | | |
