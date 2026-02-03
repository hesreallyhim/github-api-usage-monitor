/**
 * Poller Main Loop & Entry Point
 *
 * The polling loop and child process entry point.
 * Extracted from poller.ts for testability via dependency injection.
 */

import type { ReducerState } from '../types';
import { POLL_INTERVAL_SECONDS, MAX_LIFETIME_MS } from '../types';
import { createInitialState, markStopped } from '../reducer';
import { readState, writeState } from '../state';
import { parseBooleanFlag, sleep } from '../utils';
import { computeSleepPlan, applyDebounce, POLL_DEBOUNCE_MS } from './sleep-plan';
import { performPoll as performPollImpl } from './perform-poll';

/**
 * Returns true if the GITHUB_API_MONITOR_DIAGNOSTICS env var is truthy.
 */
export function isDiagnosticsEnabled(): boolean {
  return parseBooleanFlag(process.env['GITHUB_API_MONITOR_DIAGNOSTICS']);
}

/**
 * Creates a SIGTERM handler that writes current state and exits.
 * Replaces the anonymous closure for testability.
 *
 * @param getState - Returns current reducer state (or undefined if not yet initialized)
 * @param writeFn - State persistence function
 * @param exitFn - Process exit function
 */
export function createShutdownHandler(
  getState: () => ReducerState | undefined,
  writeFn: typeof writeState,
  exitFn: (code: number) => void,
): () => void {
  return () => {
    const state = getState();
    if (state) {
      writeFn(state);
    }
    exitFn(0);
  };
}

/**
 * Dependency injection interface for runPollerLoop.
 * Production defaults are used when not provided by tests.
 */
export interface LoopDeps {
  registerSignal: (event: string, handler: () => void) => void;
  exit: (code: number) => void;
  now: () => number;
  performPoll: typeof performPollImpl;
}

const defaultDeps: LoopDeps = {
  registerSignal: (event, handler) => {
    process.on(event, handler);
  },
  exit: (code) => {
    process.exit(code);
  },
  now: () => Date.now(),
  performPoll: performPollImpl,
};

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
export async function runPollerLoop(
  token: string,
  intervalSeconds: number,
  diagnosticsEnabled: boolean,
  deps: LoopDeps = defaultDeps,
): Promise<void> {
  let state: ReducerState | undefined;
  const startTimeMs = deps.now();

  // Handle graceful shutdown - write state immediately before exiting
  const shutdownHandler = createShutdownHandler(() => state, writeState, deps.exit);
  deps.registerSignal('SIGTERM', shutdownHandler);

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
  state = await deps.performPoll(state, token, diagnosticsEnabled);

  // Polling loop (runs until SIGTERM or max lifetime exceeded)
  while (true) {
    try {
      // Defense-in-depth: exit if max lifetime exceeded
      const elapsedMs = deps.now() - startTimeMs;
      if (elapsedMs >= MAX_LIFETIME_MS) {
        console.error(
          `Poller exceeded max lifetime (${MAX_LIFETIME_MS}ms). ` + `Exiting as safety measure.`,
        );
        state = markStopped(state);
        writeState(state);
        deps.exit(0);
        return;
      }

      const rawPlan = computeSleepPlan(
        state,
        intervalSeconds * 1000,
        Math.floor(deps.now() / 1000),
      );
      const plan = applyDebounce(rawPlan, POLL_DEBOUNCE_MS);
      await sleep(plan.sleepMs);
      state = await deps.performPoll(state, token, diagnosticsEnabled);

      if (plan.burst) {
        await sleep(plan.burstGapMs);
        state = await deps.performPoll(state, token, diagnosticsEnabled);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Poller loop error: ${message}`);
      // Avoid a tight loop; fall back to the base interval before trying again.
      await sleep(intervalSeconds * 1000);
    }
  }
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
  const diagnosticsEnabled = isDiagnosticsEnabled();

  if (!token) {
    console.error('GITHUB_API_MONITOR_TOKEN not set');
    process.exit(1);
  }

  const interval = intervalStr ? parseInt(intervalStr, 10) : POLL_INTERVAL_SECONDS;

  await runPollerLoop(token, interval, diagnosticsEnabled);
}
