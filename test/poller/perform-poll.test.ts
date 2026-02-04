/**
 * Tests for performPoll and buildDiagnosticsEntry.
 *
 * Mocks: github (fetchRateLimit), reducer (reduce, recordFailure),
 *        state (writeState), poll-log (appendPollLogEntry).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performPoll, buildDiagnosticsEntry, createRateLimitControlState } from '../../src/poller';
import type { RateLimitResponse } from '../../src/types';
import type { ReduceResult, UpdateResult } from '../../src/reducer';
import { makeBucket, makeState } from './helpers';

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------

vi.mock('../../src/github', () => ({
  fetchRateLimit: vi.fn(),
}));

vi.mock('../../src/reducer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/reducer')>();
  return {
    ...actual,
    reduce: vi.fn(),
    recordFailure: vi.fn(),
  };
});

vi.mock('../../src/state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state')>();
  return {
    ...actual,
    writeState: vi.fn(),
    readState: vi.fn(),
  };
});

vi.mock('../../src/poll-log', () => ({
  appendPollLogEntry: vi.fn(),
}));

// -----------------------------------------------------------------------------
// Local helpers
// -----------------------------------------------------------------------------

function makeUpdate(overrides: Partial<UpdateResult> = {}): UpdateResult {
  return {
    bucket: makeBucket(),
    delta: 3,
    anomaly: false,
    window_crossed: false,
    ...overrides,
  };
}

function makeSample(
  overrides: Partial<{ used: number; remaining: number; reset: number; limit: number }> = {},
) {
  return { used: 10, remaining: 4990, reset: 1706203600, limit: 5000, ...overrides };
}

// =============================================================================
// buildDiagnosticsEntry (pure, zero mocks)
// =============================================================================

describe('buildDiagnosticsEntry', () => {
  const timestamp = '2025-01-25T12:05:00Z';

  it('returns correct PollLogEntry with matching bucket snapshots', (): void => {
    const reduceResult: ReduceResult = {
      state: makeState({ core: makeBucket() }),
      updates: { core: makeUpdate({ delta: 5, window_crossed: true, anomaly: false }) },
    };
    const rateLimitData: RateLimitResponse = {
      resources: {
        core: makeSample({ used: 15, remaining: 4985, reset: 1706203600, limit: 5000 }),
      },
      rate: makeSample(),
    };

    const entry = buildDiagnosticsEntry(reduceResult, rateLimitData, 7, timestamp);

    expect(entry).toEqual({
      timestamp,
      poll_number: 7,
      buckets: {
        core: {
          used: 15,
          remaining: 4985,
          reset: 1706203600,
          limit: 5000,
          delta: 5,
          window_crossed: true,
          anomaly: false,
        },
      },
    });
  });

  it('skips buckets present in updates but missing from rateLimitData.resources', (): void => {
    const reduceResult: ReduceResult = {
      state: makeState(),
      updates: { ghost: makeUpdate() },
    };
    const rateLimitData: RateLimitResponse = {
      resources: {},
      rate: makeSample(),
    };

    const entry = buildDiagnosticsEntry(reduceResult, rateLimitData, 1, timestamp);

    expect(entry.buckets).toEqual({});
  });

  it('handles empty updates → returns entry with empty buckets', (): void => {
    const reduceResult: ReduceResult = {
      state: makeState(),
      updates: {},
    };
    const rateLimitData: RateLimitResponse = {
      resources: { core: makeSample() },
      rate: makeSample(),
    };

    const entry = buildDiagnosticsEntry(reduceResult, rateLimitData, 3, timestamp);

    expect(entry.buckets).toEqual({});
    expect(entry.poll_number).toBe(3);
    expect(entry.timestamp).toBe(timestamp);
  });

  it('preserves all fields: delta, window_crossed, anomaly, used, remaining, reset, limit', (): void => {
    const reduceResult: ReduceResult = {
      state: makeState(),
      updates: {
        search: makeUpdate({ delta: 42, window_crossed: true, anomaly: true }),
      },
    };
    const rateLimitData: RateLimitResponse = {
      resources: { search: { used: 100, remaining: 900, reset: 9999, limit: 1000 } },
      rate: makeSample(),
    };

    const entry = buildDiagnosticsEntry(reduceResult, rateLimitData, 10, timestamp);
    const snap = entry.buckets['search'];

    expect(snap).toBeDefined();
    expect(snap.delta).toBe(42);
    expect(snap.window_crossed).toBe(true);
    expect(snap.anomaly).toBe(true);
    expect(snap.used).toBe(100);
    expect(snap.remaining).toBe(900);
    expect(snap.reset).toBe(9999);
    expect(snap.limit).toBe(1000);
  });

  it('handles multiple buckets correctly', (): void => {
    const reduceResult: ReduceResult = {
      state: makeState(),
      updates: {
        core: makeUpdate({ delta: 1 }),
        search: makeUpdate({ delta: 2 }),
      },
    };
    const rateLimitData: RateLimitResponse = {
      resources: {
        core: makeSample({ used: 5 }),
        search: makeSample({ used: 20 }),
      },
      rate: makeSample(),
    };

    const entry = buildDiagnosticsEntry(reduceResult, rateLimitData, 4, timestamp);

    expect(Object.keys(entry.buckets)).toEqual(['core', 'search']);
    expect(entry.buckets['core'].delta).toBe(1);
    expect(entry.buckets['search'].delta).toBe(2);
  });
});

// =============================================================================
// performPoll
// =============================================================================

describe('performPoll', () => {
  // We need to dynamically import the mocked modules so we can set return values
  let fetchRateLimit: ReturnType<typeof vi.fn>;
  let reduce: ReturnType<typeof vi.fn>;
  let recordFailure: ReturnType<typeof vi.fn>;
  let writeState: ReturnType<typeof vi.fn>;
  let appendPollLogEntry: ReturnType<typeof vi.fn>;

  beforeEach(async (): Promise<void> => {
    const github = await import('../../src/github');
    const reducer = await import('../../src/reducer');
    const state = await import('../../src/state');
    const pollLog = await import('../../src/poll-log');

    fetchRateLimit = github.fetchRateLimit as ReturnType<typeof vi.fn>;
    reduce = reducer.reduce as ReturnType<typeof vi.fn>;
    recordFailure = reducer.recordFailure as ReturnType<typeof vi.fn>;
    writeState = state.writeState as ReturnType<typeof vi.fn>;
    appendPollLogEntry = pollLog.appendPollLogEntry as ReturnType<typeof vi.fn>;

    vi.clearAllMocks();
  });

  it('success path: calls fetchRateLimit, reduce, writeState; returns new state', async (): Promise<void> => {
    const oldState = makeState();
    const newState = makeState({ core: makeBucket({ total_used: 10 }) });
    const rateLimitData: RateLimitResponse = {
      resources: { core: { used: 10, remaining: 4990, reset: 1706203600, limit: 5000 } },
      rate: { used: 10, remaining: 4990, reset: 1706203600, limit: 5000 },
    };

    fetchRateLimit.mockResolvedValue({ success: true, data: rateLimitData });
    reduce.mockReturnValue({ state: newState, updates: {} } satisfies ReduceResult);

    const result = await performPoll(oldState, 'test-token', false, createRateLimitControlState());

    expect(fetchRateLimit).toHaveBeenCalledWith('test-token');
    expect(reduce).toHaveBeenCalledWith(
      oldState,
      rateLimitData,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    );
    expect(writeState).toHaveBeenCalledWith(newState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.state).toBe(newState);
    }
  });

  it('failure path: calls recordFailure, writeState; returns failure state', async (): Promise<void> => {
    const oldState = makeState();
    const failState = { ...oldState, poll_failures: 1, last_error: 'API error' };

    fetchRateLimit.mockResolvedValue({ success: false, error: 'API error' });
    recordFailure.mockReturnValue(failState);

    const result = await performPoll(oldState, 'test-token', false, createRateLimitControlState());

    expect(recordFailure).toHaveBeenCalledWith(oldState, 'API error', {
      rate_limit_kind: undefined,
    });
    expect(writeState).toHaveBeenCalledWith(failState);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.state).toBe(failState);
      expect(result.error).toBe('API error');
    }
    expect(reduce).not.toHaveBeenCalled();
  });

  it('diagnostics enabled: calls appendPollLogEntry', async (): Promise<void> => {
    const oldState = makeState();
    const newState = { ...makeState(), poll_count: 8 };
    const rateLimitData: RateLimitResponse = {
      resources: { core: { used: 5, remaining: 4995, reset: 1706203600, limit: 5000 } },
      rate: { used: 5, remaining: 4995, reset: 1706203600, limit: 5000 },
    };

    fetchRateLimit.mockResolvedValue({ success: true, data: rateLimitData });
    reduce.mockReturnValue({
      state: newState,
      updates: {
        core: { bucket: makeBucket(), delta: 5, anomaly: false, window_crossed: false },
      },
    } satisfies ReduceResult);

    await performPoll(oldState, 'test-token', true, createRateLimitControlState());

    expect(appendPollLogEntry).toHaveBeenCalledTimes(1);
    const logEntry = appendPollLogEntry.mock.calls[0][0] as {
      poll_number: number;
      buckets: Record<string, unknown>;
    };
    expect(logEntry.poll_number).toBe(8);
    expect(logEntry.buckets).toHaveProperty('core');
  });

  it('rate-limit failure: logs error entry when diagnostics enabled', async (): Promise<void> => {
    const oldState = makeState();
    const failState = { ...oldState, poll_failures: 1, last_error: 'HTTP 429' };

    fetchRateLimit.mockResolvedValue({
      success: false,
      error: 'HTTP 429: Too Many Requests - secondary',
      rate_limit: {
        status: 429,
        message: 'Secondary rate limit exceeded',
        rate_limit_remaining: 1,
        rate_limit_reset: 1706203600,
        retry_after_seconds: 30,
      },
    });
    recordFailure.mockReturnValue(failState);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1706200000 * 1000);

    await performPoll(oldState, 'test-token', true, createRateLimitControlState());

    expect(appendPollLogEntry).toHaveBeenCalledTimes(1);
    const logEntry = appendPollLogEntry.mock.calls[0][0] as {
      poll_number: number;
      error?: { kind?: string; status?: number };
    };
    expect(logEntry.poll_number).toBe(6);
    expect(logEntry.error?.kind).toBe('secondary');
    expect(logEntry.error?.status).toBe(429);

    nowSpy.mockRestore();
  });

  it('diagnostics disabled: does NOT call appendPollLogEntry', async (): Promise<void> => {
    const oldState = makeState();
    const newState = makeState();
    const rateLimitData: RateLimitResponse = {
      resources: { core: { used: 5, remaining: 4995, reset: 1706203600, limit: 5000 } },
      rate: { used: 5, remaining: 4995, reset: 1706203600, limit: 5000 },
    };

    fetchRateLimit.mockResolvedValue({ success: true, data: rateLimitData });
    reduce.mockReturnValue({ state: newState, updates: {} } satisfies ReduceResult);

    await performPoll(oldState, 'test-token', false, createRateLimitControlState());

    expect(appendPollLogEntry).not.toHaveBeenCalled();
  });
});
