/**
 * Poller Main Loop & Entry Point
 *
 * The polling loop and child process entry point.
 * Extracted from poller.ts for testability via dependency injection.
 */
import type { ReducerState } from '../types';
import { writeState } from '../state';
import { performPoll as performPollImpl } from './perform-poll';
/**
 * Returns true if the GITHUB_API_MONITOR_DIAGNOSTICS env var is truthy.
 */
export declare function isDiagnosticsEnabled(): boolean;
/**
 * Creates a SIGTERM handler that writes current state and exits.
 * Replaces the anonymous closure for testability.
 *
 * @param getState - Returns current reducer state (or undefined if not yet initialized)
 * @param writeFn - State persistence function
 * @param exitFn - Process exit function
 */
export declare function createShutdownHandler(getState: () => ReducerState | undefined, writeFn: typeof writeState, exitFn: (code: number) => void): () => void;
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
export declare function runPollerLoop(token: string, intervalSeconds: number, diagnosticsEnabled: boolean, deps?: LoopDeps): Promise<void>;
/**
 * Entry point when run as child process.
 * Exported for use by poller-entry.ts
 */
export declare function main(): Promise<void>;
