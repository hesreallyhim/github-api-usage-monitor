# V1 Blockers: Analysis and Resolution

This document captures the four major blockers identified during the v1 readiness review and the decisions/changes made to address them.

## Overview

During critical review of the GitHub API Usage Monitor v1, four blockers were identified related to process lifecycle management and orphan prevention. These were categorized as P0 (must fix before production) due to the serious risk of orphaned background processes in CI environments.

---

## Blocker #1: Race Condition in State Handoff

### Problem
The post handler could read stale state before the poller's final write completed. Sequence:
1. Post sends SIGTERM to poller
2. Poller is mid-sleep (up to 30 seconds)
3. Post immediately reads state file
4. State reflects data from before SIGTERM, missing any updates

### Root Cause
The original SIGTERM handler only set a flag (`running = false`). The actual state write happened after the sleep completed and the loop exited naturally. If the sleep was long, there was a significant window where the state file was stale.

### Solution
Modified the SIGTERM handler to write state and exit immediately:

```typescript
// Before: Just set flag, let loop exit naturally
process.on('SIGTERM', () => {
  running = false;
});

// After: Write state and exit immediately
process.on('SIGTERM', () => {
  if (state) {
    writeState(state);
  }
  process.exit(0);
});
```

### Files Changed
- `src/poller.ts`: SIGTERM handler now writes state and calls `process.exit(0)`

### Dead Code Removed
The immediate exit made several code paths unreachable:
- `running = false` in handler (process exits immediately)
- `if (!running) break` check in loop (never reached)
- Final `writeState(state)` after loop (never reached)

These were removed to prevent future confusion about control flow.

---

## Blocker #2: No Kill Verification

### Problem
After sending SIGTERM, the post handler assumed the poller died. If the poller was stuck or hung, it could continue running as an orphan after the job completed.

### Solution
Implemented `killPollerWithVerification()` that:
1. Sends SIGTERM
2. Polls process status every 100ms for up to 3 seconds
3. Escalates to SIGKILL if process doesn't die
4. Returns status indicating whether escalation was needed

```typescript
export async function killPollerWithVerification(pid: number): Promise<KillOutcome> {
  // Check if process exists
  if (!isProcessRunning(pid)) {
    return { success: false, error: 'Process not found', notFound: true };
  }

  // Send SIGTERM
  process.kill(pid, 'SIGTERM');

  // Wait for process to die (up to 3s)
  const startTime = Date.now();
  while (Date.now() - startTime < KILL_TIMEOUT_MS) {
    await sleep(KILL_CHECK_INTERVAL_MS);
    if (!isProcessRunning(pid)) {
      return { success: true, escalated: false };
    }
  }

  // Escalate to SIGKILL
  process.kill(pid, 'SIGKILL');
  // ... verify death or report failure
}
```

### Files Changed
- `src/poller.ts`: Added `killPollerWithVerification()`, `isProcessRunning()`, constants
- `src/post.ts`: Changed to use async verification, added warning if SIGKILL was needed

---

## Blocker #3: SIGKILL Could Arrive Before Final Write

### Problem
Even with kill verification, there was a race:
1. Post sends SIGTERM
2. Poller is sleeping (30s default interval)
3. 3 second timeout expires
4. Post sends SIGKILL
5. Poller dies mid-sleep, never writes final state

### Solution
This was addressed by fixing Blocker #1. The SIGTERM handler now writes state immediately and exits with `process.exit(0)`. Since the handler executes synchronously and exits before returning, the poller never stays in sleep long enough for the 3-second timeout to expire.

The 3-second timeout is now a safety net for truly stuck processes (e.g., infinite loop, deadlock), not a race condition with normal shutdown.

### Files Changed
Same as Blocker #1 - the solution addresses both issues.

---

## Blocker #4: No Startup Verification

### Problem
`spawnPoller()` returned success with a PID, but didn't verify the process actually started successfully. The child could fail immediately (bad path, missing file, environment issue) and the main action would never know.

### Solution

**1. Added "alive" signal mechanism:**
- New field `poller_started_at_ts` in `ReducerState`
- Poller sets this timestamp immediately on startup, before any API calls
- This confirms: process spawned, env vars read, file I/O works

```typescript
// In poller's runPollerLoop():
state = { ...state, poller_started_at_ts: new Date().toISOString() };
writeState(state);  // Signal alive before first API call
```

**2. Added startup verification in main action:**
```typescript
export async function verifyPollerStartup(
  timeoutMs: number = 5000
): Promise<VerifyStartupOutcome> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = readState();
    if (result.success && result.state.poller_started_at_ts !== null) {
      return { success: true };
    }
    await sleep(100);
  }

  return { success: false, error: `Poller did not signal startup within ${timeoutMs}ms` };
}
```

**3. Main action verifies startup:**
```typescript
const verifyResult = await verifyPollerStartup();
if (!verifyResult.success) {
  // Cleanup potentially dead/stuck process
  killPoller(spawnResult.pid);
  throw new Error(`Poller startup verification failed: ${verifyResult.error}`);
}
```

### Design Decision: Why Not Just Check PID?
We discussed alternatives:
- **Check PID alive after delay**: Fast but only catches immediate crashes, not "started but broken"
- **Wait for first API poll**: Robust but adds network latency to startup
- **Alive signal (chosen)**: Fast (no network), confirms process health without API dependency

The alive signal approach separates "did process start" from "can it poll the API" - both important but different concerns.

### Files Changed
- `src/types.ts`: Added `poller_started_at_ts: string | null` to `ReducerState`
- `src/reducer.ts`: Initialize field as `null` in `createInitialState()`
- `src/poller.ts`: Set timestamp and write state immediately on startup
- `src/state.ts`: Added `verifyPollerStartup()` function
- `src/main.ts`: Call verification after spawn, cleanup on failure

---

## Testing Strategy

### Unit Tests (90 tests)
Existing unit tests cover the core logic. The new `poller_started_at_ts` field is included in state validation.

### Integration Tests (4 tests)
A dedicated integration test harness (`test/integration/poller-lifecycle.integration.test.ts`) tests real process behavior:

1. **Startup signal test**: Spawns poller, waits for `poller_started_at_ts` to be set
2. **SIGTERM clean exit**: Verifies process exits with code 0 and writes final state
3. **SIGKILL escalation**: Tests a hung process (ignores SIGTERM) is killed by SIGKILL
4. **Process detection**: Verifies `process.kill(pid, 0)` correctly detects running/dead processes

### Safety Net
The integration tests include an orphan cleanup mechanism:
```typescript
const spawnedPids = new Set<number>();

afterAll(() => {
  for (const pid of spawnedPids) {
    try { process.kill(pid, 'SIGKILL'); } catch { }
  }
});
```

---

## Commits

1. `feat: add integration test harness for poller lifecycle`
2. `fix: eslint glob pattern and add orphan process safety net in tests`
3. `feat: add kill verification with SIGKILL escalation`
4. `fix: SIGTERM handler writes state and exits immediately`
5. `feat: add startup verification for poller process`

---

## Remaining Considerations

### P2 (Future Enhancement): Max Lifetime
A maximum lifetime for the poller (e.g., 6 hours) would provide defense-in-depth against truly pathological scenarios where SIGKILL fails or the PID file is lost.

### P2 (Future Enhancement): Heartbeat
A heartbeat mechanism could detect stuck pollers mid-job, not just at shutdown. Lower priority since the current safeguards handle the critical shutdown path.

---

## Follow-up Work (from testing-expert review)

**Verdict:** PRODUCTION-READY with minor caveats

### Completed

| Priority | Issue | Status |
|----------|-------|--------|
| P1 | Race condition in `process.kill(pid, 0)` test - used `setTimeout` instead of `await sleep()` | **DONE** (commit `e2ad485`) |

### Pending

| Priority | Issue | Status |
|----------|-------|--------|
| P2 | Missing test for startup verification timeout path | **DONE** |
| P2 | `isValidState()` doesn't validate `poller_started_at_ts`, `stopped_at_ts`, or `last_error` types | **DONE** |
| P3 | Consider max lifetime for defense-in-depth | Future |
| P3 | Consider making timeout constants configurable | Future |

### Other Improvements

| Item | Status |
|------|--------|
| ESLint migrated from deprecated `tseslint.config()` to `defineConfig()` | **DONE** (commit `d9a23ca`) |  
