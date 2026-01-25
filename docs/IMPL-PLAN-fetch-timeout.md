# Implementation Plan: Fix Critical Issue #3 - No Fetch Timeout in Poller

**Status:** Complete
**Ticket:** Fix Critical Issue #3 - No Fetch Timeout in Poller
**Branch:** build-spec
**Completed:** 2026-01-25

---

## Problem Statement

In `src/github.ts` (lines 47-56), the `fetch()` call to GitHub's `/rate_limit` endpoint has no timeout configured. If GitHub becomes unresponsive, the fetch hangs indefinitely.

The poller loop in `src/poller.ts` is single-threaded - it cannot respond to SIGTERM while blocked on a network call. This makes the poller unkillable on network issues.

**Impact:** The `post` entry point will fail to kill the poller, but the process is actually still alive, hung on I/O.

---

## Implementation Plan

### 1. Add FETCH_TIMEOUT_MS constant to types.ts

Add a configurable timeout constant:
```typescript
export const FETCH_TIMEOUT_MS = 10000; // 10 seconds
```

### 2. Modify fetchRateLimit in src/github.ts

Add AbortController with timeout to the fetch call:

1. Create AbortController and set up timeout
2. Pass signal to fetch options
3. Clear timeout on success
4. Handle AbortError in catch block, converting to FetchRateLimitError

Key implementation details:
- Use `AbortController` API (native in Node 20+)
- Clear timeout in both success and error paths to prevent memory leaks
- Detect AbortError by checking `error.name === 'AbortError'`
- Return descriptive error message for timeout vs other network errors

### 3. Add timeout tests to test/github.test.ts

Create new test cases:
1. Test that fetch times out after the configured duration
2. Test that AbortError is caught and returned as FetchRateLimitError
3. Verify the error message indicates a timeout occurred

Test approach:
- Use vi.stubGlobal to mock fetch
- Create a fetch that returns a never-resolving promise
- Use vi.useFakeTimers to advance time
- Verify the function returns with appropriate error

### 4. Future consideration (out of scope for this ticket)

The ticket mentions storing an AbortController at module level in `src/poller.ts` that can be aborted on SIGTERM. This is a more complex change that would require:
- Module-level state
- Coordination between SIGTERM handler and ongoing fetch
- This is noted but NOT implemented in this ticket

---

## Acceptance Criteria Checklist

- [x] fetch() has a timeout that aborts after 10 seconds
- [x] AbortError is caught and returned as FetchRateLimitError
- [x] Tests verify timeout behavior
- [x] All existing tests still pass (90/90)
- [x] Lint and typecheck pass

---

## Files to Modify

1. `src/types.ts` - Add FETCH_TIMEOUT_MS constant
2. `src/github.ts` - Add timeout to fetchRateLimit
3. `test/github.test.ts` - Add timeout tests

---

## Notes

- Node 20+ has native AbortController support, no polyfill needed
- The timeout should be generous enough for slow networks but short enough to prevent indefinite hangs
- 10 seconds is a reasonable default for a rate limit API call

---

## Implementation Summary

### Commits

1. `docs: add implementation plan for fetch timeout fix` - Initial planning document
2. `feat(types): add FETCH_TIMEOUT_MS constant` - Added 10-second timeout constant
3. `fix(github): add timeout to fetchRateLimit using AbortController` - Core fix implementation
4. `test(github): add tests for fetchRateLimit timeout behavior` - Added 8 new test cases

### Key Changes

**src/types.ts:**
- Added `FETCH_TIMEOUT_MS = 10000` constant

**src/github.ts:**
- Created AbortController with timeout before each fetch call
- Passed abort signal to fetch options
- Clear timeout on both success and error paths to prevent memory leaks
- Detect AbortError by checking `error.name === 'AbortError'`
- Return descriptive timeout error message including the timeout duration

**test/github.test.ts:**
- Added 8 new test cases for fetchRateLimit function
- Tests cover: AbortError handling, network errors, HTTP errors, successful responses, signal passing, and invalid JSON responses

### Test Results

All 90 tests pass:
- test/platform.test.ts: 12 tests
- test/output.test.ts: 16 tests
- test/reducer.test.ts: 20 tests
- test/github.test.ts: 26 tests (8 new)
- test/state.test.ts: 16 tests
