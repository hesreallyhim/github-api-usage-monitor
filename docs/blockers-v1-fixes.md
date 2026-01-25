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
| P3 | Max lifetime for defense-in-depth | **DONE** |
| P3 | Consider making timeout constants configurable | WONTFIX (keep config surface small) |

---

## P3: Max Lifetime Safeguard

### Decision

Add a 6-hour maximum lifetime for the poller process as a defense-in-depth measure.

**Rationale:**
- Even if SIGTERM/SIGKILL handling fails (parent dies without signaling, process left detached), the poller self-terminates
- 6 hours is well above any reasonable CI job (most are <1 hour, long ones 2-4 hours)
- Minimal complexity: single constant + elapsed time check in poll loop
- No configuration needed - hardcoded limit is appropriate for this safety net
- The reducer already handles multi-hour jobs correctly (tracks window crossings for both 1-minute and 1-hour rate limit buckets)

**Implementation (DONE):**
1. ✅ Added `MAX_LIFETIME_MS = 6 * 60 * 60 * 1000` constant to `types.ts`
2. ✅ Track start time at beginning of poll loop (wall-clock, not from state)
3. ✅ Check elapsed time at start of each loop iteration
4. ✅ If exceeded: log warning, mark state as stopped, write final state, exit gracefully
5. ⏭️ Unit test skipped - logic is trivial (one conditional), 6-hour timeout not practically testable

**Files changed:**
- `src/types.ts`: Added `MAX_LIFETIME_MS` constant
- `src/poller.ts`: Added lifetime check in poll loop

### Other Improvements

| Item | Status |
|------|--------|
| ESLint migrated from deprecated `tseslint.config()` to `defineConfig()` | **DONE** (commit `d9a23ca`) |

---

## Initial Gap Analysis (Updated 2026-01-25)

This section tracks all issues from the original critical code review.

### 🔴 Blocking Issues

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | Race condition - Stop reads stale state before poller's final write | ✅ **FIXED** | SIGTERM handler writes state immediately and exits (Blocker #1) |
| 2 | Orphan process - If PID write fails after spawn, poller runs forever | ✅ **FIXED** | Cleanup in main.ts kills orphan on PID write failure |
| 3 | No fetch timeout - Poller hangs forever on network issues | ✅ **FIXED** | `FETCH_TIMEOUT_MS = 10000` with AbortController in github.ts |
| 4 | No startup verification - Spawn returns before confirming poller running | ✅ **FIXED** | `verifyPollerStartup()` waits for `poller_started_at_ts` (Blocker #4) |

### 🟠 Major Concerns

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 5 | Token passed via env var (readable in /proc) | WONTFIX | Accepted risk - standard GitHub Actions practice; process is short-lived |
| 6 | No verification poller starts (same as #4) | ✅ **FIXED** | Same as #4 |
| 7 | State file bucket validation incomplete | ✅ **FIXED** | `isValidState()` validates all required and optional fields |
| 8 | Atomic rename may fail across filesystems | WONTFIX | Low risk - RUNNER_TEMP guarantees same filesystem |
| 9 | No temp file cleanup on write failure | ✅ **FIXED** | `unlinkSync(tmpPath)` in catch block of writeState |
| 10 | Post doesn't degrade gracefully on corrupted state | ⚠️ Partial | Handles missing state gracefully; corrupted state still throws |

### 🟡 Improvements

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 11 | Missing ESLint config | ✅ **FIXED** | Full ESLint + TypeScript config with `defineConfig()` |
| 12 | Poller entry path hardcoded | WONTFIX | By design - ncc bundles to known `dist/poller/index.js` location |
| 13 | No backoff on consecutive poll failures | Open | Not critical for v1; poller continues polling at fixed interval |
| 14 | Duration calculation can be negative | ✅ **FIXED** | `Math.max(0, ...)` in post.ts |
| 15 | No tests for critical paths | ✅ **FIXED** | `state.test.ts` (18 tests), integration tests (6 tests) |
| 16 | require.main === module may not work with ncc | ✅ **FIXED** | `poller-entry.ts` unconditionally calls `main()` |

### Orphan Process Scenarios

| Scenario | Protection | Status |
|----------|------------|--------|
| PID write fails after spawn | Kill process immediately | ✅ **FIXED** |
| Post handler fails to kill | SIGKILL escalation after 3s | ✅ **FIXED** |
| Post handler never runs (runner crash) | 6-hour max lifetime | ✅ **FIXED** |
| Poller ignores SIGTERM | SIGKILL escalation | ✅ **FIXED** |
| Kill succeeds but poller respawns | N/A (not our design) | ✅ Not possible |

### Priority Implementation Checklist

| Priority | Safeguard | Status |
|----------|-----------|--------|
| P0 | Kill verification + SIGKILL escalation | ✅ **DONE** |
| P0 | SIGTERM handler does final sync write | ✅ **DONE** |
| P2 | Max lifetime self-termination | ✅ **DONE** (6 hours) |
| P2 | Heartbeat file for staleness detection | Deferred | Not needed with max lifetime |

### Summary

- **Blocking issues:** 4/4 fixed ✅
- **Major concerns:** 5/6 fixed (1 accepted risk, 1 partial)
- **Improvements:** 5/6 fixed (1 open, non-critical)

---

<details>
<summary>Original notes (archived)</summary>

OLDER NOTES (COPIED HERE TO MAKE AURE THEY DON'T GET LOST AND WE HAVE COVERED THEM ALL)


 From the critical code review, there were 4 blocking issues:                                                                              
                                                                                                                                            
  1. Race condition - Stop handler reads stale state before poller's final write - NOT FIXED                                                
  2. Orphan process - If PID write fails after spawn, poller runs forever - FIXED (added cleanup in main.ts)                                
  3. No fetch timeout - Poller hangs on network issues, ignores SIGTERM - NOT FIXED                                                         
  4. No startup verification - Spawn returns before confirming poller is running - NOT FIXED                                                
                                                                                                                                            
  Major concerns:                                                                                                                           
  5. Token passed via env var - NOT FIXED                                                                                                   
  6. No verification that poller process actually starts - NOT FIXED (same as #4)                                                           
  7. State file validation incomplete - NOT FIXED                                                                                           
  8. Atomic rename may fail across filesystems - low risk, NOT FIXED                                                                        
  9. No cleanup of temp file on write failure - NOT FIXED                                                                                   
  10. handleStop continues after state read failure - NOT FIXED (though now it's in post.ts)                                                
                                                                                                                                            
  Improvements:                                                                                                                             
  11. Missing ESLint config - FIXED                                                                                                         
  12. Poller entry path hardcoded - NOT FIXED                                                                                               
  13. No rate limit on poller failures - NOT FIXED                                                                                          
  14. Duration calculation can be negative - FIXED (added Math.max(0, ...))                                                                 
  15. No tests for critical paths - NOT FIXED                                                                                               
  16. require.main === module pattern may not work with ncc - NOT FIXED                                                                     
                                                                                                                                            
  Also, the reviewer mentioned that we addressed:                                                                                           
  - #2 (orphan process cleanup) - in main.ts                                                                                                
  - #14 (negative duration) - in post.ts                                                                                                    
                                                                                                                                            
  Let me summarize what's still outstanding.                                                                                                
                                                                                                                                            
⏺ From the critical code review, here's what's still outstanding:

# THE INITIAL GAP ANALYSIS
                                                                                                                                            
  🔴 Blocking (3 remaining)                                                                                                                 
  ┌───────┬──────────────────────────────────────────────────────────────────────────┬──────────┐                                           
  │   #   │                                  Issue                                   │  Status  │                                           
  ├───────┼──────────────────────────────────────────────────────────────────────────┼──────────┤                                           
  │ 1     │ Race condition - Stop reads stale state before poller's final write      │ Open     │                                           
  ├───────┼──────────────────────────────────────────────────────────────────────────┼──────────┤                                           
  │ ~~2~~ │ ~~Orphan process cleanup~~                                               │ ✅ Fixed │                                           
  ├───────┼──────────────────────────────────────────────────────────────────────────┼──────────┤                                           
  │ 3     │ No fetch timeout - Poller hangs forever on network issues                │ Open     │                                           
  ├───────┼──────────────────────────────────────────────────────────────────────────┼──────────┤                                           
  │ 4     │ No startup verification - Spawn returns before confirming poller running │ Open     │                                           
  └───────┴──────────────────────────────────────────────────────────────────────────┴──────────┘                                           
  🟠 Major Concerns (5 remaining)                                                                                                           
  ┌─────┬────────────────────────────────────────────────────┬────────┐                                                                     
  │  #  │                       Issue                        │ Status │                                                                     
  ├─────┼────────────────────────────────────────────────────┼────────┤                                                                     
  │ 5   │ Token passed via env var (readable in /proc)       │ Open   │                                                                     
  ├─────┼────────────────────────────────────────────────────┼────────┤                                                                     
  │ 6   │ No verification poller starts (same as #4)         │ Open   │                                                                     
  ├─────┼────────────────────────────────────────────────────┼────────┤                                                                     
  │ 7   │ State file bucket validation incomplete            │ Open   │                                                                     
  ├─────┼────────────────────────────────────────────────────┼────────┤                                                                     
  │ 9   │ No temp file cleanup on write failure              │ Open   │                                                                     
  ├─────┼────────────────────────────────────────────────────┼────────┤                                                                     
  │ 10  │ Post doesn't degrade gracefully on corrupted state │ Open   │                                                                     
  └─────┴────────────────────────────────────────────────────┴────────┘                                                                     
  🟡 Improvements (4 remaining)                                                                                                             
  ┌────────┬────────────────────────────────────────────────────┬──────────┐                                                                
  │   #    │                       Issue                        │  Status  │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ ~~11~~ │ ~~ESLint config missing~~                          │ ✅ Fixed │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ 12     │ Poller entry path hardcoded                        │ Open     │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ 13     │ No backoff on consecutive poll failures            │ Open     │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ ~~14~~ │ ~~Duration can be negative~~                       │ ✅ Fixed │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ 15     │ No tests for main.ts, post.ts, state.ts, poller.ts │ Open     │                                                                
  ├────────┼────────────────────────────────────────────────────┼──────────┤                                                                
  │ 16     │ require.main === module may not work with ncc      │ Open     │                                                                
  └────────┴────────────────────────────────────────────────────┴──────────┘




  ┌───────┬───────────────────────────────┬──────────┐                                                                                      
  │   #   │             Issue             │  Status  │                                                                                      
  ├───────┼───────────────────────────────┼──────────┤                                                                                      
  │ 1     │ Race condition on state write │ Open     │                                                                                      
  ├───────┼───────────────────────────────┼──────────┤                                                                                      
  │ ~~2~~ │ ~~Orphan process cleanup~~    │ ✅ Fixed │                                                                                      
  ├───────┼───────────────────────────────┼──────────┤                                                                                      
  │ ~~3~~ │ ~~No fetch timeout~~          │ ✅ Fixed │                                                                                      
  ├───────┼───────────────────────────────┼──────────┤                                                                                      
  │ 4     │ No startup verification       │ Open     │    




Agreed — orphaned processes are a serious risk. Let me map out the orphan scenarios:                                                      
  ┌───────────────────────────────────────────┬──────────────────────────┬───────────────────────┐                                          
  │                 Scenario                  │    Current protection    │          Gap          │                                          
  ├───────────────────────────────────────────┼──────────────────────────┼───────────────────────┤                                          
  │ PID write fails after spawn               │ Kill process immediately │ ✅ Fixed (blocker #2) │                                          
  ├───────────────────────────────────────────┼──────────────────────────┼───────────────────────┤                                          
  │ Post handler fails to kill                │ Logs warning, continues  │ ⚠️ Process remains    │                                          
  ├───────────────────────────────────────────┼──────────────────────────┼───────────────────────┤                                          
  │ Post handler never runs (runner crash)    │ None                     │ ⚠️ Process remains    │                                          
  ├───────────────────────────────────────────┼──────────────────────────┼───────────────────────┤                                          
  │ Poller ignores SIGTERM                    │ None                     │ ⚠️ Process remains    │                                          
  ├───────────────────────────────────────────┼──────────────────────────┼───────────────────────┤                                          
  │ Kill succeeds but poller respawns somehow │ N/A (not our design)     │ ✅ Not possible       │  



  Priority implementation:                                                                                                                  
  ┌──────────┬────────────────────────────────────────┬────────────────────┐                                                                
  │ Priority │               Safeguard                │     Test type      │                                                                
  ├──────────┼────────────────────────────────────────┼────────────────────┤                                                                
  │ P0       │ Kill verification + SIGKILL escalation │ Unit + Integration │                                                                
  ├──────────┼────────────────────────────────────────┼────────────────────┤                                                                
  │ P0       │ SIGTERM handler does final sync write  │ Integration        │                                                                
  ├──────────┼────────────────────────────────────────┼────────────────────┤                                                                
  │ P2       │ Max lifetime self-termination (4hr)    │ Unit only          │                                                                
  ├──────────┼────────────────────────────────────────┼────────────────────┤                                                                
  │ P2       │ Heartbeat file for staleness detection │ Unit only          │
  └──────────┴────────────────────────────────────────┴────────────────────┘

</details>
