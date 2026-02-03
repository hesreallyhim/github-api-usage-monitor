/**
 * Poller Process Lifecycle (Kill)
 *
 * Functions for stopping the poller process: SIGTERM, verification, SIGKILL escalation.
 * Extracted from poller.ts for testability.
 */

import { sleep } from '../utils';

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

// Internal — not exported; callers should not depend on timeout values.
// Tests mock process.kill directly rather than relying on these constants.
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

/**
 * Checks whether a process with the given PID is currently running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
