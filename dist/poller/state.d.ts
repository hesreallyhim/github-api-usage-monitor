/**
 * State Manager
 * Layer: core
 *
 * Provided ports:
 *   - state.read
 *   - state.write
 *
 * Manages persistent state in $RUNNER_TEMP.
 * Uses atomic rename for safe writes.
 */
import type { ReducerState } from './types';
export interface ReadStateResult {
    success: true;
    state: ReducerState;
}
export interface ReadStateError {
    success: false;
    error: string;
    /** True if file doesn't exist (expected for first read) */
    notFound: boolean;
}
export type ReadStateOutcome = ReadStateResult | ReadStateError;
/**
 * Reads reducer state from disk.
 *
 * @returns State or error with details
 */
export declare function readState(): ReadStateOutcome;
export interface WriteStateResult {
    success: true;
}
export interface WriteStateError {
    success: false;
    error: string;
}
export type WriteStateOutcome = WriteStateResult | WriteStateError;
/**
 * Writes reducer state to disk atomically.
 * Creates state directory if it doesn't exist.
 * Cleans up temp file on failure to prevent orphaned files.
 *
 * @param state - State to persist
 */
export declare function writeState(state: ReducerState): WriteStateOutcome;
/**
 * Validates that parsed JSON has the ReducerState shape.
 * Handles missing fields gracefully per spec (W4).
 */
export declare function isValidState(obj: unknown): obj is ReducerState;
/**
 * Writes the poller PID to disk.
 */
export declare function writePid(pid: number): WriteStateOutcome;
/**
 * Reads the poller PID from disk.
 */
export declare function readPid(): number | null;
/**
 * Removes the PID file.
 */
export declare function removePid(): void;
export interface VerifyStartupResult {
    success: true;
}
export interface VerifyStartupError {
    success: false;
    error: string;
}
export type VerifyStartupOutcome = VerifyStartupResult | VerifyStartupError;
/**
 * Waits for the poller to signal startup by setting poller_started_at_ts.
 *
 * The poller writes this timestamp immediately on startup, before any API calls.
 * This confirms:
 *   - Process spawned successfully
 *   - Environment variables were read
 *   - File I/O is working
 *
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @returns Success or error with details
 */
export declare function verifyPollerStartup(timeoutMs?: number): Promise<VerifyStartupOutcome>;
