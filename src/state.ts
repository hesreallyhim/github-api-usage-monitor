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

import * as fs from 'fs';
import type { ReducerState } from './types';
import { getStateDir, getStatePath, getStateTmpPath } from './paths';

// -----------------------------------------------------------------------------
// Port: state.read
// -----------------------------------------------------------------------------

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
export function readState(): ReadStateOutcome {
  const statePath = getStatePath();

  try {
    const content = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;

    // TODO: Validate parsed state has correct shape
    // For now, trust the structure
    if (!isValidState(parsed)) {
      return {
        success: false,
        error: 'Invalid state structure',
        notFound: false,
      };
    }

    return { success: true, state: parsed };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return {
        success: false,
        error: 'State file not found',
        notFound: true,
      };
    }
    return {
      success: false,
      error: `Failed to read state: ${error.message}`,
      notFound: false,
    };
  }
}

// -----------------------------------------------------------------------------
// Port: state.write
// -----------------------------------------------------------------------------

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
export function writeState(state: ReducerState): WriteStateOutcome {
  const stateDir = getStateDir();
  const statePath = getStatePath();
  const tmpPath = getStateTmpPath();

  try {
    // Ensure directory exists
    fs.mkdirSync(stateDir, { recursive: true });

    // Write to temp file
    const content = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmpPath, content, 'utf-8');

    // Atomic rename
    fs.renameSync(tmpPath, statePath);

    return { success: true };
  } catch (err) {
    // Clean up temp file on failure to prevent orphaned files
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors - file may not exist
    }
    const error = err as Error;
    return {
      success: false,
      error: `Failed to write state: ${error.message}`,
    };
  }
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Validates that parsed JSON has the ReducerState shape.
 * Handles missing fields gracefully per spec (W4).
 */
export function isValidState(value: unknown): value is ReducerState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // Required fields
  if (typeof obj['buckets'] !== 'object' || obj['buckets'] === null) {
    return false;
  }
  if (typeof obj['started_at_ts'] !== 'string') {
    return false;
  }
  if (typeof obj['interval_seconds'] !== 'number') {
    return false;
  }
  if (typeof obj['poll_count'] !== 'number') {
    return false;
  }
  if (typeof obj['poll_failures'] !== 'number') {
    return false;
  }

  // Optional fields have defaults in the type
  // stopped_at_ts: string | null
  // last_error: string | null

  return true;
}

// -----------------------------------------------------------------------------
// PID file management
// -----------------------------------------------------------------------------

import { getPidPath } from './paths';

/**
 * Writes the poller PID to disk.
 */
export function writePid(pid: number): WriteStateOutcome {
  const pidPath = getPidPath();
  const stateDir = getStateDir();

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(pidPath, String(pid), 'utf-8');
    return { success: true };
  } catch (err) {
    const error = err as Error;
    return {
      success: false,
      error: `Failed to write PID: ${error.message}`,
    };
  }
}

/**
 * Reads the poller PID from disk.
 */
export function readPid(): number | null {
  const pidPath = getPidPath();

  try {
    const content = fs.readFileSync(pidPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Removes the PID file.
 */
export function removePid(): void {
  const pidPath = getPidPath();
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // Ignore errors - file may not exist
  }
}
