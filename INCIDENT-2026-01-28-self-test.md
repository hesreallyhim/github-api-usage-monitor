# INCIDENT — Self-Test Double-Start + Zero Usage

**Date:** 2026-01-28  
**Scope:** Self-test workflow (`test-ubuntu`) on GitHub Actions  
**Source logs:** `.claude/raw-logs`

## Summary

The self-test workflow invoked the action twice (intended "start" and "stop").  
Because the action’s `main` always **starts** a new poller and there is **no explicit stop mode**, the second invocation **started a second poller** instead of stopping the first. This caused:

- Two different poller PIDs in a single job.
- PID/state file overwritten by the second invocation.
- Post-job cleanup running twice with inconsistent state.
- The runner killing an orphaned poller at job end.
- Reported usage remaining decreased, but `used` stayed at 0.

## Evidence (from `.claude/raw-logs`)

Start #1:

- `Monitor started (PID: 2034, tracking 14 buckets)`

Simulated usage:

- `curl ... https://api.github.com/repos/hesreallyhim/github-api-usage-monitor`

Start #2 (intended as stop, but actually starts a new poller):

- `Monitor started (PID: 2078, tracking 14 buckets)`

Post job cleanup runs **twice**:

- Two blocks of `Stopping GitHub API usage monitor...`
- Second block shows `Warnings: 1`

Runner cleanup:

- `Terminate orphan process: pid (2034) (node)`

Final usage output:

- `GitHub API Usage: 0 requests in 0s (1 polls)`
- `core: 0 used, 4990 remaining`

## Root Causes

1. **Workflow invokes the action twice without a stop mode**
   - Both steps execute `main` and **start** a poller.
   - The second invocation overwrites PID/state for the first poller.

2. **Post hook runs once per action invocation**
   - Two action steps => two post cleanups.
   - Cleanup only knows about the *latest* PID/state.
   - First poller becomes an orphan and is killed by the runner.

3. **Polling interval vs test duration**
   - Poll interval is 30s; the test window is ~12s.
   - Only the initial poll occurs, which is treated as a baseline.
   - Usage calls during the test are not captured in a subsequent poll.

## Impact

- Incorrect usage reporting (`used` stays 0).
- Orphaned poller process until runner cleanup.
- Confusing logs and mismatched PIDs.

## Next Steps (Proposed)

1. **Switch self-test to a single action step** (start in main, stop via post).
2. **If explicit stop is desired**, add an input (`mode: start|stop`) and enforce it.
3. **Make self-test capture usage**:
   - Reduce poll interval for the self-test run, or
   - Trigger an immediate poll on stop and compute delta.
