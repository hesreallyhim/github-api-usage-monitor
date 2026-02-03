/**
 * Start Monitor Tests
 *
 * Tests for the startMonitor function that orchestrates the monitor startup.
 * Uses vi.mock at module level to mock all dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startMonitor } from '../src/start';
import type { ReducerState, RateLimitResponse } from '../src/types';
import type { ReduceResult } from '../src/reducer';

// -----------------------------------------------------------------------------
// Module-level mocks
// -----------------------------------------------------------------------------

vi.mock('@actions/core');
vi.mock('../src/platform');
vi.mock('../src/poller');
vi.mock('../src/state');
vi.mock('../src/reducer');
vi.mock('../src/github');

// Import mocked modules
import * as core from '@actions/core';
import { assertSupported } from '../src/platform';
import { spawnPoller, killPoller } from '../src/poller';
import { writeState, writePid, verifyPollerStartup } from '../src/state';
import { createInitialState, reduce } from '../src/reducer';
import { fetchRateLimit } from '../src/github';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeInitialState(): ReducerState {
  return {
    buckets: {},
    started_at_ts: '2026-01-25T12:00:00.000Z',
    stopped_at_ts: null,
    poller_started_at_ts: null,
    interval_seconds: 30,
    poll_count: 0,
    poll_failures: 0,
    last_error: null,
  };
}

function makeStateWithBucket(): ReducerState {
  return {
    buckets: {
      core: {
        last_reset: 1706200000,
        last_used: 1,
        total_used: 0,
        windows_crossed: 0,
        anomalies: 0,
        last_seen_ts: '2026-01-25T12:00:00Z',
        limit: 5000,
        remaining: 4999,
        first_used: 1,
        first_remaining: 4999,
      },
    },
    started_at_ts: '2026-01-25T12:00:00.000Z',
    stopped_at_ts: null,
    poller_started_at_ts: null,
    interval_seconds: 30,
    poll_count: 1,
    poll_failures: 0,
    last_error: null,
  };
}

function makeRateLimitResponse(): RateLimitResponse {
  return {
    resources: {
      core: {
        limit: 5000,
        remaining: 4999,
        reset: 1706200000,
        used: 1,
      },
    },
    rate: {
      limit: 5000,
      remaining: 4999,
      reset: 1706200000,
      used: 1,
    },
  };
}

function makeReduceResult(): ReduceResult {
  return {
    state: makeStateWithBucket(),
    updates: {
      core: {
        bucket: {
          last_reset: 1706200000,
          last_used: 1,
          total_used: 0,
          windows_crossed: 0,
          anomalies: 0,
          last_seen_ts: '2026-01-25T12:00:00Z',
          limit: 5000,
          remaining: 4999,
          first_used: 1,
          first_remaining: 4999,
        },
        delta: 0,
        anomaly: false,
        window_crossed: false,
        new_bucket: true,
      },
    },
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('startMonitor', () => {
  beforeEach((): void => {
    vi.clearAllMocks();

    // Set up default happy-path mocks
    vi.mocked(core.info).mockImplementation(() => undefined);
    vi.mocked(assertSupported).mockImplementation(() => undefined);
    vi.mocked(fetchRateLimit).mockResolvedValue({
      success: true,
      data: makeRateLimitResponse(),
      timestamp: '2026-01-25T12:00:00Z',
    });
    vi.mocked(createInitialState).mockReturnValue(makeInitialState());
    vi.mocked(reduce).mockReturnValue(makeReduceResult());
    vi.mocked(writeState).mockReturnValue({ success: true });
    vi.mocked(spawnPoller).mockReturnValue({ success: true, pid: 12345 });
    vi.mocked(writePid).mockReturnValue({ success: true });
    vi.mocked(verifyPollerStartup).mockResolvedValue({ success: true });
  });

  it('happy path: starts monitor successfully', async (): Promise<void> => {
    await startMonitor('test-token', false);

    // Verify all functions were called in order
    expect(core.info).toHaveBeenCalledWith('Starting GitHub API usage monitor...');
    expect(assertSupported).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('Validating token with initial API call...');
    expect(fetchRateLimit).toHaveBeenCalledWith('test-token');
    expect(createInitialState).toHaveBeenCalledTimes(1);
    expect(reduce).toHaveBeenCalledWith(
      makeInitialState(),
      makeRateLimitResponse(),
      '2026-01-25T12:00:00Z',
    );
    expect(writeState).toHaveBeenCalledWith(makeStateWithBucket());
    expect(spawnPoller).toHaveBeenCalledWith('test-token', false);
    expect(writePid).toHaveBeenCalledWith(12345);
    expect(core.info).toHaveBeenCalledWith('Verifying poller startup...');
    expect(verifyPollerStartup).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('Monitor started (PID: 12345, tracking 1 buckets)');
  });

  it('passes diagnostics flag through to spawnPoller', async (): Promise<void> => {
    await startMonitor('test-token', true);

    expect(spawnPoller).toHaveBeenCalledWith('test-token', true);
  });

  it('throws when fetchRateLimit fails', async (): Promise<void> => {
    vi.mocked(fetchRateLimit).mockResolvedValue({
      success: false,
      error: 'Network timeout',
    });

    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Token validation failed: Network timeout',
    );

    // Verify it stopped after fetchRateLimit failure
    expect(createInitialState).not.toHaveBeenCalled();
  });

  it('throws when writeState fails', async (): Promise<void> => {
    vi.mocked(writeState).mockReturnValue({
      success: false,
      error: 'Disk full',
    });

    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Failed to write initial state: Disk full',
    );

    // Verify it stopped after writeState failure
    expect(spawnPoller).not.toHaveBeenCalled();
  });

  it('throws when spawnPoller fails', async (): Promise<void> => {
    vi.mocked(spawnPoller).mockReturnValue({
      success: false,
      error: 'Failed to spawn process',
    });

    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Failed to spawn poller: Failed to spawn process',
    );

    // Verify it stopped after spawnPoller failure
    expect(writePid).not.toHaveBeenCalled();
  });

  it('throws and kills poller when writePid fails', async (): Promise<void> => {
    vi.mocked(writePid).mockReturnValue({
      success: false,
      error: 'Permission denied',
    });

    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Failed to write PID: Permission denied',
    );

    // Verify killPoller was called for cleanup
    expect(killPoller).toHaveBeenCalledWith(12345);

    // Verify it stopped after writePid failure
    expect(verifyPollerStartup).not.toHaveBeenCalled();
  });

  it('does not throw when killPoller fails during writePid cleanup', async (): Promise<void> => {
    vi.mocked(writePid).mockReturnValue({
      success: false,
      error: 'Permission denied',
    });
    vi.mocked(killPoller).mockImplementation(() => {
      throw new Error('Process already dead');
    });

    // Should still throw the writePid error, not the killPoller error
    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Failed to write PID: Permission denied',
    );

    expect(killPoller).toHaveBeenCalledWith(12345);
  });

  it('throws and kills poller when verifyPollerStartup fails', async (): Promise<void> => {
    vi.mocked(verifyPollerStartup).mockResolvedValue({
      success: false,
      error: 'Poller did not start within timeout',
    });

    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Poller startup verification failed: Poller did not start within timeout',
    );

    // Verify killPoller was called for cleanup
    expect(killPoller).toHaveBeenCalledWith(12345);
  });

  it('does not throw when killPoller fails during verifyPollerStartup cleanup', async (): Promise<void> => {
    vi.mocked(verifyPollerStartup).mockResolvedValue({
      success: false,
      error: 'Poller did not start within timeout',
    });
    vi.mocked(killPoller).mockImplementation(() => {
      throw new Error('Process already dead');
    });

    // Should still throw the verifyPollerStartup error, not the killPoller error
    await expect(startMonitor('test-token', false)).rejects.toThrow(
      'Poller startup verification failed: Poller did not start within timeout',
    );

    expect(killPoller).toHaveBeenCalledWith(12345);
  });
});
