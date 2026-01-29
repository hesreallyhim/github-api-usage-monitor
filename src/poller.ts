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

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import type { ReducerState } from './types';
import { POLL_INTERVAL_SECONDS, MAX_LIFETIME_MS } from './types';
import { fetchRateLimit } from './github';
import { reduce, recordFailure, createInitialState, markStopped } from './reducer';
import { readState, writeState } from './state';

// -----------------------------------------------------------------------------
// Port: poller.spawn
// -----------------------------------------------------------------------------

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
export function spawnPoller(token: string): SpawnOutcome {
  try {
    // Resolve path to bundled poller entry
    // ncc bundles to dist/poller/index.js
    const actionPath = process.env['GITHUB_ACTION_PATH'];
    const baseDir = actionPath
      ? path.resolve(actionPath, 'dist')
      : path.dirname(process.argv[1] ?? '');
    const separator = baseDir.endsWith(path.sep) ? '' : path.sep;
    const pollerEntry = `${baseDir}${separator}poller${path.sep}index.js`;

    const child: ChildProcess = spawn(process.execPath, [pollerEntry], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        GITHUB_API_MONITOR_TOKEN: token,
        GITHUB_API_MONITOR_INTERVAL: String(POLL_INTERVAL_SECONDS),
      },
    });

    // Allow parent to exit without waiting
    child.unref();

    if (!child.pid) {
      return { success: false, error: 'Failed to get child PID' };
    }

    return { success: true, pid: child.pid };
  } catch (err) {
    const error = err as Error;
    return { success: false, error: `Failed to spawn poller: ${error.message}` };
  }
}

// -----------------------------------------------------------------------------
// Port: poller.kill
// -----------------------------------------------------------------------------

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

const KILL_TIMEOUT_MS = 3000;
const KILL_CHECK_INTERVAL_MS = 100;

/**
 * Kills the poller process by PID.
 * Sends SIGTERM for graceful shutdown.
 *
 * @param pid - Process ID to kill
 */
export function killPoller(pid: number): KillOutcome {
  try {
    // Check if process exists
    process.kill(pid, 0);

    // Send SIGTERM
    process.kill(pid, 'SIGTERM');

    return { success: true };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ESRCH') {
      return {
        success: false,
        error: 'Process not found',
        notFound: true,
      };
    }
    return {
      success: false,
      error: `Failed to kill poller: ${error.message}`,
      notFound: false,
    };
  }
}

/**
 * Kills poller with verification and SIGKILL escalation.
 * Sends SIGTERM, waits for exit, escalates to SIGKILL if needed.
 */
export async function killPollerWithVerification(pid: number): Promise<KillOutcome> {
  // Check if process exists
  if (!isProcessRunning(pid)) {
    return { success: false, error: 'Process not found', notFound: true };
  }

  // Send SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ESRCH') {
      return { success: false, error: 'Process not found', notFound: true };
    }
    return { success: false, error: `Failed to send SIGTERM: ${error.message}`, notFound: false };
  }

  // Wait for process to die
  const startTime = Date.now();
  while (Date.now() - startTime < KILL_TIMEOUT_MS) {
    await sleep(KILL_CHECK_INTERVAL_MS);
    if (!isProcessRunning(pid)) {
      return { success: true, escalated: false };
    }
  }

  // Escalate to SIGKILL
  try {
    process.kill(pid, 'SIGKILL');
    await sleep(KILL_CHECK_INTERVAL_MS);
    if (!isProcessRunning(pid)) {
      return { success: true, escalated: true };
    }
    return { success: false, error: 'Process survived SIGKILL', notFound: false };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ESRCH') {
      return { success: true, escalated: true }; // Died between check and kill
    }
    return { success: false, error: `Failed to send SIGKILL: ${error.message}`, notFound: false };
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Adaptive sleep planning
// -----------------------------------------------------------------------------

export interface SleepPlan {
  /** Milliseconds to sleep before next poll */
  sleepMs: number;
  /** If true, perform a second poll shortly after the first (burst mode) */
  burst: boolean;
  /** If burst, milliseconds to sleep between the two polls */
  burstGapMs: number;
}

const BURST_THRESHOLD_S = 8;
const PRE_RESET_BUFFER_S = 3;
const POST_RESET_DELAY_S = 3;
const MIN_SLEEP_MS = 1000;

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
export function computeSleepPlan(
  state: ReducerState,
  baseIntervalMs: number,
  nowEpochSeconds: number,
): SleepPlan {
  const activeResets = Object.values(state.buckets)
    .filter((b) => b.total_used > 0)
    .map((b) => b.last_reset)
    .filter((r) => r > nowEpochSeconds);

  if (activeResets.length === 0) {
    return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
  }

  const soonestReset = Math.min(...activeResets);
  const secondsUntilReset = soonestReset - nowEpochSeconds;

  if (secondsUntilReset <= 0) {
    // Reset already passed — poll quickly to pick up new window
    return { sleepMs: Math.min(2000, baseIntervalMs), burst: false, burstGapMs: 0 };
  }

  if (secondsUntilReset <= BURST_THRESHOLD_S) {
    // Close to reset — burst mode: poll before and after
    const preResetSleep = Math.max((secondsUntilReset - PRE_RESET_BUFFER_S) * 1000, MIN_SLEEP_MS);
    const burstGap = (PRE_RESET_BUFFER_S + POST_RESET_DELAY_S) * 1000;
    return { sleepMs: preResetSleep, burst: true, burstGapMs: burstGap };
  }

  if (secondsUntilReset * 1000 < baseIntervalMs) {
    // Reset coming before next regular poll — target pre-reset
    const targetSleep = (secondsUntilReset - PRE_RESET_BUFFER_S) * 1000;
    return { sleepMs: Math.max(targetSleep, MIN_SLEEP_MS), burst: false, burstGapMs: 0 };
  }

  return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
}

// -----------------------------------------------------------------------------
// Poll debounce
// -----------------------------------------------------------------------------

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
export const POLL_DEBOUNCE_MS = 5000;

/**
 * Applies a minimum-interval debounce to a sleep plan.
 * Clamps both the initial sleep and the burst gap (if any) so that no
 * two polls can occur closer than `debounceMs` apart.
 */
export function applyDebounce(plan: SleepPlan, debounceMs: number): SleepPlan {
  return {
    ...plan,
    sleepMs: Math.max(plan.sleepMs, debounceMs),
    burstGapMs: plan.burst ? Math.max(plan.burstGapMs, debounceMs) : plan.burstGapMs,
  };
}

// -----------------------------------------------------------------------------
// Poller main loop (when run as child process)
// -----------------------------------------------------------------------------

/**
 * Main polling loop.
 * Runs indefinitely until SIGTERM received.
 *
 * Startup sequence:
 *   1. Read or create initial state
 *   2. Write state immediately (signals "alive" to parent)
 *   3. Begin polling loop
 *
 * Shutdown sequence (SIGTERM):
 *   1. Write current state immediately
 *   2. Exit with code 0
 *
 * The parent process (main.ts) waits for the state file to confirm
 * the poller started successfully before proceeding.
 */
async function runPollerLoop(token: string, intervalSeconds: number): Promise<void> {
  let state: ReducerState;
  const startTimeMs = Date.now();

  // Handle graceful shutdown - write state immediately before exiting
  process.on('SIGTERM', () => {
    if (state) {
      writeState(state);
    }
    process.exit(0);
  });

  // Initial state or read existing
  const stateResult = readState();

  if (stateResult.success) {
    state = stateResult.state;
  } else {
    state = createInitialState();
  }

  // Signal alive: set timestamp and write state so parent can detect startup
  state = { ...state, poller_started_at_ts: new Date().toISOString() };
  writeState(state);

  // Initial poll immediately
  state = await performPoll(state, token);

  // Polling loop (runs until SIGTERM or max lifetime exceeded)
  while (true) {
    // Defense-in-depth: exit if max lifetime exceeded
    const elapsedMs = Date.now() - startTimeMs;
    if (elapsedMs >= MAX_LIFETIME_MS) {
      console.error(
        `Poller exceeded max lifetime (${MAX_LIFETIME_MS}ms). ` + `Exiting as safety measure.`,
      );
      state = markStopped(state);
      writeState(state);
      process.exit(0);
    }

    const rawPlan = computeSleepPlan(state, intervalSeconds * 1000, Math.floor(Date.now() / 1000));
    const plan = applyDebounce(rawPlan, POLL_DEBOUNCE_MS);
    await sleep(plan.sleepMs);
    state = await performPoll(state, token);

    if (plan.burst) {
      await sleep(plan.burstGapMs);
      state = await performPoll(state, token);
    }
  }
}

/**
 * Performs a single poll and updates state.
 */
async function performPoll(state: ReducerState, token: string): Promise<ReducerState> {
  const timestamp = new Date().toISOString();
  const result = await fetchRateLimit(token);

  if (!result.success) {
    const newState = recordFailure(state, result.error);
    writeState(newState);
    return newState;
  }

  const { state: newState } = reduce(state, result.data, timestamp);
  writeState(newState);
  return newState;
}

// -----------------------------------------------------------------------------
// Child process entry point
// -----------------------------------------------------------------------------

/**
 * Entry point when run as child process.
 * Exported for use by poller-entry.ts
 */
export async function main(): Promise<void> {
  const token = process.env['GITHUB_API_MONITOR_TOKEN'];
  const intervalStr = process.env['GITHUB_API_MONITOR_INTERVAL'];

  if (!token) {
    console.error('GITHUB_API_MONITOR_TOKEN not set');
    process.exit(1);
  }

  const interval = intervalStr ? parseInt(intervalStr, 10) : POLL_INTERVAL_SECONDS;

  await runPollerLoop(token, interval);
}

// Entry point moved to poller-entry.ts for ESM compatibility
// See: poller-entry.ts is built as dist/poller/index.js
