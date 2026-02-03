/**
 * Tests for killPoller, killPollerWithVerification, and isProcessRunning.
 *
 * Mocks: only ../src/utils (for sleep in killPollerWithVerification).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { killPoller, killPollerWithVerification, isProcessRunning } from '../../src/poller';

// sleep mock — killPollerWithVerification calls sleep between retries.
vi.mock('../../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils')>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// -----------------------------------------------------------------------------
// killPoller
// -----------------------------------------------------------------------------

describe('killPoller', () => {
  let killSpy: MockInstance;

  beforeEach((): void => {
    killSpy = vi.spyOn(process, 'kill');
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('returns success when process exists and SIGTERM succeeds', (): void => {
    killSpy.mockReturnValue(true);

    const result = killPoller(12345);

    expect(result.success).toBe(true);
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(killSpy).toHaveBeenNthCalledWith(1, 12345, 0);
    expect(killSpy).toHaveBeenNthCalledWith(2, 12345, 'SIGTERM');
  });

  it('returns notFound when process does not exist (ESRCH)', (): void => {
    const error = new Error('No such process') as NodeJS.ErrnoException;
    error.code = 'ESRCH';
    killSpy.mockImplementation(() => {
      throw error;
    });

    const result = killPoller(99999);

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBe('Process not found');
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(99999, 0);
  });

  it('returns error for other errors (e.g., EPERM)', (): void => {
    const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
    error.code = 'EPERM';
    killSpy.mockImplementation(() => {
      throw error;
    });

    const result = killPoller(12345);

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(false);
    expect(result.error).toBe('Failed to kill poller: Operation not permitted');
    expect(killSpy).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// killPollerWithVerification
// -----------------------------------------------------------------------------

// NOTE: vi.mock('../../src/utils') is hoisted to the top of this file.
// This means `sleep` from '../utils' is mocked to resolve immediately for ALL tests,
// including killPollerWithVerification. The fake timers below are therefore unnecessary
// for sleep control — they remain only for any setTimeout-based logic if present.
describe('killPollerWithVerification', () => {
  let killSpy: MockInstance;

  beforeEach((): void => {
    killSpy = vi.spyOn(process, 'kill');
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('returns notFound when process is not running initially', async (): Promise<void> => {
    const error = new Error('No such process') as NodeJS.ErrnoException;
    error.code = 'ESRCH';
    killSpy.mockImplementation(() => {
      throw error;
    });

    const result = await killPollerWithVerification(99999);

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBe('Process not found');
  });

  it('returns success with escalated=false when SIGTERM kills process', async (): Promise<void> => {
    let callCount = 0;
    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      callCount++;
      if (callCount === 1 && signal === 0) {
        return true;
      }
      if (callCount === 2 && signal === 'SIGTERM') {
        return true;
      }
      const error = new Error('No such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });

    // sleep is mocked to resolve immediately (see vi.mock('../../src/utils')),
    // so the verification loop completes without real delays.
    const result = await killPollerWithVerification(12345);

    expect(result.success).toBe(true);
    expect(result.escalated).toBe(false);
  });

  it('returns error when SIGTERM throws EPERM (non-ESRCH)', async (): Promise<void> => {
    let callCount = 0;
    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      callCount++;
      // First call: signal 0 check — process exists
      if (callCount === 1 && signal === 0) {
        return true;
      }
      // Second call: SIGTERM — throws EPERM
      const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });

    const result = await killPollerWithVerification(12345);

    expect(result).toEqual({
      success: false,
      error: 'Failed to send SIGTERM: Operation not permitted',
      notFound: false,
    });
  });

  it('returns success when SIGTERM sends but process.kill throws ESRCH (died between check and send)', async (): Promise<void> => {
    let callCount = 0;
    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      callCount++;
      if (callCount === 1 && signal === 0) {
        return true;
      }
      const error = new Error('No such process') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });

    const result = await killPollerWithVerification(12345);

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBe('Process not found');
  });

  // ---- SIGKILL escalation tests (lines 97-109) ----
  // These tests mock Date.now to force the SIGTERM timeout loop to expire,
  // reaching the SIGKILL escalation block. The strategy:
  //   - Date.now returns 0 on first call (startTime), then jumps past 3000ms
  //   - process.kill(pid, 0) always returns true (process alive) during the wait loop
  //   - SIGTERM succeeds (doesn't throw)
  //   - SIGKILL behavior varies per test

  it('escalates to SIGKILL when SIGTERM times out — SIGKILL succeeds', async (): Promise<void> => {
    let dateNowCallCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      dateNowCallCount++;
      // First call sets startTime=0, second call exceeds KILL_TIMEOUT_MS (3000)
      return dateNowCallCount <= 1 ? 0 : 4000;
    });

    // After SIGKILL is sent, next signal-0 check returns ESRCH (process died)
    let sigkillSent = false;
    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 'SIGKILL') {
        sigkillSent = true;
        return true;
      }
      if (signal === 0 && sigkillSent) {
        const error = new Error('No such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      if (signal === 0) return true; // alive during timeout loop
      if (signal === 'SIGTERM') return true;
      return true;
    });

    const result = await killPollerWithVerification(12345);

    expect(result).toEqual({ success: true, escalated: true });
  });

  it('returns failure when process survives SIGKILL', async (): Promise<void> => {
    let dateNowCallCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      dateNowCallCount++;
      return dateNowCallCount <= 1 ? 0 : 4000;
    });

    // Process stays alive through everything — signal 0 always succeeds
    killSpy.mockImplementation((_pid: number, _signal?: string | number) => {
      return true;
    });

    const result = await killPollerWithVerification(12345);

    expect(result).toEqual({
      success: false,
      error: 'Process survived SIGKILL',
      notFound: false,
    });
  });

  it('returns escalated success when ESRCH during SIGKILL (died between check and kill)', async (): Promise<void> => {
    let dateNowCallCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      dateNowCallCount++;
      return dateNowCallCount <= 1 ? 0 : 4000;
    });

    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) return true; // alive during checks
      if (signal === 'SIGTERM') return true;
      if (signal === 'SIGKILL') {
        // Process died between the alive-check and the SIGKILL
        const error = new Error('No such process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        throw error;
      }
      return true;
    });

    const result = await killPollerWithVerification(12345);

    expect(result).toEqual({ success: true, escalated: true });
  });

  it('returns error when SIGKILL throws non-ESRCH error', async (): Promise<void> => {
    let dateNowCallCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      dateNowCallCount++;
      return dateNowCallCount <= 1 ? 0 : 4000;
    });

    killSpy.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) return true;
      if (signal === 'SIGTERM') return true;
      if (signal === 'SIGKILL') {
        const error = new Error('Operation not permitted') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return true;
    });

    const result = await killPollerWithVerification(12345);

    expect(result).toEqual({
      success: false,
      error: 'Failed to send SIGKILL: Operation not permitted',
      notFound: false,
    });
  });
});

// -----------------------------------------------------------------------------
// isProcessRunning
// -----------------------------------------------------------------------------

describe('isProcessRunning', () => {
  it('returns true for current PID', (): void => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it('returns false for non-existent PID', (): void => {
    // INT32_MAX (2^31-1) — kernel-valid but extremely unlikely to be allocated
    expect(isProcessRunning(2147483647)).toBe(false);
  });
});
