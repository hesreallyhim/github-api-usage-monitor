# ADR-002: Adaptive polling with pre-reset targeting and debounce

**Status:** Accepted
**Date:** 2026-01-29

## Context

The poller samples GitHub's `/rate_limit` endpoint at a fixed 30-second interval. The `search` bucket has a 60-second window. Any API usage between our last poll and the window reset is invisible — after the reset, `used` starts from 0 and we cannot recover what was consumed in the final moments of the previous window.

With a fixed 30s poll, worst case: **30 seconds of unobserved usage before a reset** — 50% of a 60-second window.

We know exactly when resets happen: `BucketState.last_reset` (from the API's `reset` field) is the unix epoch when the current window expires. We can use this to schedule polls strategically.

### Staggered resets compound the problem

When multiple short-window buckets are active (e.g. `search`, `code_search`, `graphql`), their reset times are determined by first interaction and can be staggered by seconds. Naive burst-mode polling around each reset independently would produce rapid-fire polls (6+ in 15 seconds) with diminishing returns, since each post-reset poll already captures pre-reset state for the next bucket over.

## Decision

### 1. Adaptive sleep planning (`computeSleepPlan`)

Replace the fixed sleep interval with a pure function that examines upcoming bucket resets and computes when to poll next:

| Time to reset | Behavior | Uncertainty |
|---------------|----------|-------------|
| > base interval | Normal sleep (30s) | Same as before |
| 9s – base interval | Sleep until 3s before reset | ~3s |
| <= 8s (burst zone) | Two polls: one pre-reset, one post-reset | ~3s both sides |
| Already passed | Quick recovery poll | Minimal |
| No active buckets | Normal sleep | N/A |

The function only considers **active** buckets (`total_used > 0`), ignoring idle ones whose resets are irrelevant.

### 2. Debounce layer (`applyDebounce`)

A separate, independently tunable debounce floors all sleep durations at `POLL_DEBOUNCE_MS` (5 seconds). This prevents burst stacking when multiple resets cluster together — back-to-back bursts naturally collapse because each post-reset poll already serves as a pre-reset observation for nearby buckets.

The debounce is applied **after** `computeSleepPlan` in the poll loop, keeping the two concerns cleanly separated:

```
rawPlan = computeSleepPlan(state, baseInterval, now)
plan    = applyDebounce(rawPlan, POLL_DEBOUNCE_MS)
```

### 3. Both functions are pure

`computeSleepPlan` and `applyDebounce` are stateless pure functions. All side effects (sleeping, polling, writing state) remain in `runPollerLoop`. This makes the logic fully testable without mocking timers.

## Tunable constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `BURST_THRESHOLD_S` | 8 | `src/poller.ts` | Enter burst mode when reset is this close |
| `PRE_RESET_BUFFER_S` | 3 | `src/poller.ts` | Target poll this many seconds before reset |
| `POST_RESET_DELAY_S` | 3 | `src/poller.ts` | Wait this long after reset for second burst poll |
| `MIN_SLEEP_MS` | 1000 | `src/poller.ts` | Absolute minimum sleep (sanity floor inside `computeSleepPlan`) |
| `POLL_DEBOUNCE_MS` | 5000 | `src/poller.ts` | Minimum gap between any two polls (debounce floor) |

These values were chosen for the current workload (60s search bucket, 30s base poll interval). They should be re-evaluated if GitHub introduces shorter-window buckets or if real-world telemetry suggests different tradeoffs.

## Consequences

### Positive

- **Uncertainty drops from ~50% to ~5%** for 60-second buckets (30s unobserved -> ~3s)
- **Staggered resets handled gracefully** — debounce prevents rapid-fire polling
- **Testable** — 20 unit tests cover all branches of both functions
- **Non-breaking** — the poll loop still works identically when no resets are near; falls back to base interval
- **Independently tunable** — burst thresholds and debounce floor are separate constants

### Negative

- **Slightly more API calls** — near resets, we poll 2x instead of 1x. Acceptable because `/rate_limit` doesn't consume rate-limit quota.
- **More code** — ~70 lines of logic + 180 lines of tests. Justified by the accuracy improvement.

### Limits of this approach

The remaining ~3-5s uncertainty is **fundamental** given the constraints:

- **Polling, not push**: GitHub offers no webhook/SSE for rate-limit changes. We can only observe on poll.
- **Network RTT**: Even a perfectly-timed poll arrives 100-500ms after dispatch. The pre-reset buffer accounts for this.
- **Clock skew**: We trust that the GitHub API's `reset` epoch is accurate. Minor skew is absorbed by the 3s buffer.

No further optimization of poll scheduling can meaningfully reduce uncertainty below this floor. The next meaningful improvement would require a different data source (e.g. intercepting outbound API calls to count usage directly), which is a fundamentally different architecture.

## Alternatives considered

1. **Fixed faster interval (e.g. 10s)**: Would improve worst-case uniformly but wastes polls when no reset is near. Adaptive approach is strictly better — same peak rate, fewer total polls.

2. **Cooldown tracking (`lastPollEpoch`)**: Track when the last poll occurred and skip bursts if a recent poll already covered the pre-reset window. More complex state management for marginal gain over the simpler debounce floor.

3. **Coalescing planner**: Look at all resets within a time horizon and compute an optimal poll schedule covering all of them. Elegant but over-engineered — the debounce achieves the same practical result (4 polls instead of 6 for 3 staggered resets) with a single `Math.max`.

## Files modified

| File | Change |
|------|--------|
| `src/poller.ts` | Added `SleepPlan`, `computeSleepPlan`, `applyDebounce`, `POLL_DEBOUNCE_MS`; wired into `runPollerLoop` |
| `test/poller.test.ts` | 20 tests: 14 for `computeSleepPlan`, 6 for `applyDebounce` |

## References

- HANDOFF.md — Key design decisions section updated
- `src/poller.ts:198-295` — Implementation
- `test/poller.test.ts` — Full test suite
