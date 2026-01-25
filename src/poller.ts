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
import { fileURLToPath } from 'url';
import type { ReducerState } from './types';
import { POLL_INTERVAL_SECONDS } from './types';
import { fetchRateLimit } from './github';
import { reduce, recordFailure, createInitialState } from './reducer';
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
    // Resolve path to this file for child process entry
    const pollerEntry = path.resolve(__dirname, 'poller.js');

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

// -----------------------------------------------------------------------------
// Poller main loop (when run as child process)
// -----------------------------------------------------------------------------

/**
 * Main polling loop.
 * Runs indefinitely until SIGTERM received.
 */
async function runPollerLoop(token: string, intervalSeconds: number): Promise<void> {
  let running = true;

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    running = false;
  });

  // Initial state or read existing
  let stateResult = readState();
  let state: ReducerState;

  if (stateResult.success) {
    state = stateResult.state;
  } else {
    state = createInitialState();
  }

  // Initial poll immediately
  state = await performPoll(state, token);

  // Polling loop
  while (running) {
    await sleep(intervalSeconds * 1000);

    if (!running) break;

    state = await performPoll(state, token);
  }

  // Final state write on shutdown
  writeState(state);
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

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Child process entry point
// -----------------------------------------------------------------------------

/**
 * Entry point when run as child process.
 */
async function main(): Promise<void> {
  const token = process.env['GITHUB_API_MONITOR_TOKEN'];
  const intervalStr = process.env['GITHUB_API_MONITOR_INTERVAL'];

  if (!token) {
    console.error('GITHUB_API_MONITOR_TOKEN not set');
    process.exit(1);
  }

  const interval = intervalStr ? parseInt(intervalStr, 10) : POLL_INTERVAL_SECONDS;

  await runPollerLoop(token, interval);
}

// Run if this is the entry point
if (require.main === module) {
  main().catch((err) => {
    console.error('Poller error:', err);
    process.exit(1);
  });
}
