export { spawnPoller, type SpawnResult, type SpawnError, type SpawnOutcome } from './spawn';
export { killPoller, killPollerWithVerification, isProcessRunning, type KillResult, type KillError, type KillOutcome, } from './kill';
export { computeSleepPlan, applyDebounce, POLL_DEBOUNCE_MS, type SleepPlan } from './sleep-plan';
export { performPoll, buildDiagnosticsEntry } from './perform-poll';
export { main, runPollerLoop, createShutdownHandler, isDiagnosticsEnabled, type LoopDeps, } from './loop';
