export { spawnPoller, type SpawnResult, type SpawnError, type SpawnOutcome } from './spawn';
export { killPoller, killPollerWithVerification, isProcessRunning, type KillResult, type KillError, type KillOutcome, } from './kill';
export { computeSleepPlan, applyDebounce, POLL_DEBOUNCE_MS, type SleepPlan } from './sleep-plan';
export { performPoll, buildDiagnosticsEntry } from './perform-poll';
export { applyRateLimitGate, buildRateLimitErrorEntry, classifyRateLimitError, createRateLimitControlState, handleRateLimitError, resetRateLimitControl, MAX_SECONDARY_RETRIES, SECONDARY_DEFAULT_WAIT_MS, type RateLimitControlState, type RateLimitDecision, type RateLimitEvent, type RateLimitGateResult, } from './rate-limit-control';
export { main, runPollerLoop, createShutdownHandler, isDiagnosticsEnabled, type LoopDeps, } from './loop';
