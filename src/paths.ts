/**
 * Path Resolver
 * Layer: infra
 *
 * Provided ports:
 *   - paths.statePath
 *   - paths.pidPath
 *
 * Resolves paths within $RUNNER_TEMP for state persistence.
 */

import * as path from 'path';
import { STATE_DIR_NAME, STATE_FILE_NAME, PID_FILE_NAME, POLL_LOG_FILE_NAME } from './types';

// -----------------------------------------------------------------------------
// Port: paths.statePath
// -----------------------------------------------------------------------------

/**
 * Returns the absolute path to the state directory.
 * Creates the path string only; does not create the directory.
 *
 * @throws Error if RUNNER_TEMP is not set
 */
export function getStateDir(): string {
  const runnerTemp = process.env['RUNNER_TEMP'];
  if (!runnerTemp) {
    throw new Error('RUNNER_TEMP environment variable is not set');
  }
  return path.join(runnerTemp, STATE_DIR_NAME);
}

/**
 * Returns the absolute path to state.json
 */
export function getStatePath(): string {
  return path.join(getStateDir(), STATE_FILE_NAME);
}

// -----------------------------------------------------------------------------
// Port: paths.pidPath
// -----------------------------------------------------------------------------

/**
 * Returns the absolute path to poller.pid
 */
export function getPidPath(): string {
  return path.join(getStateDir(), PID_FILE_NAME);
}

// -----------------------------------------------------------------------------
// Port: paths.pollLogPath
// -----------------------------------------------------------------------------

/**
 * Returns the absolute path to poll-log.jsonl
 */
export function getPollLogPath(): string {
  return path.join(getStateDir(), POLL_LOG_FILE_NAME);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Returns the path for atomic write temporary file
 */
export function getStateTmpPath(): string {
  return path.join(getStateDir(), `${STATE_FILE_NAME}.tmp`);
}
