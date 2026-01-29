/**
 * Poller Process
 * Layer: poller
 *
 * Provided ports:
 *   - poller.spawn
 *   - poller.kill
 *
 * Background process that polls /rate_limit and updates state.
 * Runs as a detached child process.
 *
 * When run directly (as child process entry):
 *   - Reads config from environment
 *   - Polls at interval
 *   - Updates state file atomically
 *   - Handles SIGTERM for graceful shutdown
 */
import type { ReducerState } from './types';
export interface SpawnResult {
    success: true;
    pid: number;
}
export interface SpawnError {
    success: false;
    error: string;
}
export type SpawnOutcome = SpawnResult | SpawnError;
/**
 * Spawns the poller as a detached background process.
 *
 * @param token - GitHub token for API calls
 * @returns PID of spawned process or error
 */
export declare function spawnPoller(token: string): SpawnOutcome;
export interface KillResult {
    success: true;
    /** True if SIGKILL was needed after SIGTERM timeout */
    escalated?: boolean;
}
export interface KillError {
    success: false;
    error: string;
    /** True if process was not found (may have already exited) */
    notFound: boolean;
}
export type KillOutcome = KillResult | KillError;
/**
 * Kills the poller process by PID.
 * Sends SIGTERM for graceful shutdown.
 *
 * @param pid - Process ID to kill
 */
export declare function killPoller(pid: number): KillOutcome;
/**
 * Kills poller with verification and SIGKILL escalation.
 * Sends SIGTERM, waits for exit, escalates to SIGKILL if needed.
 */
export declare function killPollerWithVerification(pid: number): Promise<KillOutcome>;
export interface SleepPlan {
    /** Milliseconds to sleep before next poll */
    sleepMs: number;
    /** If true, perform a second poll shortly after the first (burst mode) */
    burst: boolean;
    /** If burst, milliseconds to sleep between the two polls */
    burstGapMs: number;
}
/**
 * Computes when to poll next based on upcoming bucket resets.
 *
 * Instead of a fixed interval, this targets polls just before bucket resets
 * to minimize the uncertainty window — the gap between the last pre-reset
 * observation and the actual reset.
 *
 * When a reset is imminent (≤8s away), enters "burst mode": two polls
 * bracket the reset boundary to capture both pre-reset and post-reset state.
 */
export declare function computeSleepPlan(state: ReducerState, baseIntervalMs: number, nowEpochSeconds: number): SleepPlan;
/**
 * Minimum milliseconds between any two polls.
 *
 * Prevents rapid-fire polling when multiple buckets have staggered resets
 * close together (e.g. three 60s buckets resetting 5s apart). Without this,
 * each reset triggers its own burst, producing 6 polls in ~15s. The debounce
 * floors every sleep so back-to-back bursts collapse naturally.
 *
 * Tunable independently from computeSleepPlan's reset-targeting logic.
 */
export declare const POLL_DEBOUNCE_MS = 5000;
/**
 * Applies a minimum-interval debounce to a sleep plan.
 * Clamps both the initial sleep and the burst gap (if any) so that no
 * two polls can occur closer than `debounceMs` apart.
 */
export declare function applyDebounce(plan: SleepPlan, debounceMs: number): SleepPlan;
/**
 * Entry point when run as child process.
 * Exported for use by poller-entry.ts
 */
export declare function main(): Promise<void>;
