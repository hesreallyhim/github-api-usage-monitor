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
    const pollerEntry = path.resolve(__dirname, 'poller', 'index.js');

    const child: ChildProcess = spawn(
      process.execPath,
      [pollerEntry],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          GITHUB_API_MONITOR_TOKEN: token,
          GITHUB_API_MONITOR_INTERVAL: String(POLL_INTERVAL_SECONDS),
        },
      }
    );

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
        `Poller exceeded max lifetime (${MAX_LIFETIME_MS}ms). ` +
        `Exiting as safety measure.`
      );
      state = markStopped(state);
      writeState(state);
      process.exit(0);
    }

    await sleep(intervalSeconds * 1000);
    state = await performPoll(state, token);
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
