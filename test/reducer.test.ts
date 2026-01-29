/**
 * Reducer Tests
 *
 * Table-driven tests for reducer edge cases.
 * Tests derived from spec/spec.json milestones M1, M3.
 *
 * Exit criteria:
 *   - Reducer handles same-reset deltas correctly
 *   - Reducer handles reset-boundary transitions
 *   - Reducer detects and counts anomalies
 */

import { describe, it, expect } from 'vitest';
import {
  initBucket,
  updateBucket,
  reduce,
  recordFailure,
  markStopped,
  createInitialState,
} from '../src/reducer';
import type { BucketState, RateLimitSample, RateLimitResponse, ReducerState } from '../src/types';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeSample(overrides: Partial<RateLimitSample> = {}): RateLimitSample {
  return {
    limit: 5000,
    used: 100,
    remaining: 4900,
    reset: 1706200000,
    ...overrides,
  };
}

function makeBucket(overrides: Partial<BucketState> = {}): BucketState {
  return {
    last_reset: 1706200000,
    last_used: 100,
    total_used: 0,
    windows_crossed: 0,
    anomalies: 0,
    last_seen_ts: '2026-01-25T12:00:00.000Z',
    limit: 5000,
    remaining: 4900,
    ...overrides,
  };
}

function makeState(overrides: Partial<ReducerState> = {}): ReducerState {
  return {
    buckets: {},
    started_at_ts: '2026-01-25T12:00:00.000Z',
    stopped_at_ts: null,
    interval_seconds: 30,
    poll_count: 0,
    poll_failures: 0,
    last_error: null,
    ...overrides,
  };
}

function makeResponse(buckets: Record<string, RateLimitSample>): RateLimitResponse {
  return {
    resources: buckets,
    rate: buckets['core'] ?? makeSample(),
  };
}

// -----------------------------------------------------------------------------
// initBucket tests
// -----------------------------------------------------------------------------

describe('initBucket', () => {
  it('creates bucket with zero total_used (baseline)', () => {
    const sample = makeSample({ used: 50 });
    const bucket = initBucket(sample, '2026-01-25T12:00:00.000Z');

    expect(bucket.total_used).toBe(0);
    expect(bucket.last_used).toBe(50);
    expect(bucket.last_reset).toBe(sample.reset);
    expect(bucket.windows_crossed).toBe(0);
    expect(bucket.anomalies).toBe(0);
  });

  it('preserves limit and remaining from sample', () => {
    const sample = makeSample({ limit: 1000, remaining: 800 });
    const bucket = initBucket(sample, '2026-01-25T12:00:00.000Z');

    expect(bucket.limit).toBe(1000);
    expect(bucket.remaining).toBe(800);
  });
});

// -----------------------------------------------------------------------------
// updateBucket tests - same window (monotonic used)
// -----------------------------------------------------------------------------

describe('updateBucket - same window', () => {
  it('calculates positive delta correctly', () => {
    const bucket = makeBucket({ last_used: 100, total_used: 50 });
    const sample = makeSample({ used: 150, reset: bucket.last_reset });

    const result = updateBucket(bucket, sample, '2026-01-25T12:00:30.000Z');

    expect(result.delta).toBe(50);
    expect(result.bucket.total_used).toBe(100); // 50 + 50
    expect(result.bucket.last_used).toBe(150);
    expect(result.anomaly).toBe(false);
    expect(result.window_crossed).toBe(false);
  });

  it('handles zero delta (no new usage)', () => {
    const bucket = makeBucket({ last_used: 100, total_used: 50 });
    const sample = makeSample({ used: 100, reset: bucket.last_reset });

    const result = updateBucket(bucket, sample, '2026-01-25T12:00:30.000Z');

    expect(result.delta).toBe(0);
    expect(result.bucket.total_used).toBe(50);
    expect(result.anomaly).toBe(false);
  });

  it('accumulates multiple deltas', () => {
    let bucket = makeBucket({ last_used: 0, total_used: 0 });
    const reset = bucket.last_reset;

    // Poll 1: 0 -> 10
    let result = updateBucket(bucket, makeSample({ used: 10, reset }), 'ts1');
    expect(result.bucket.total_used).toBe(10);
    bucket = result.bucket;

    // Poll 2: 10 -> 25
    result = updateBucket(bucket, makeSample({ used: 25, reset }), 'ts2');
    expect(result.bucket.total_used).toBe(25);
    bucket = result.bucket;

    // Poll 3: 25 -> 30
    result = updateBucket(bucket, makeSample({ used: 30, reset }), 'ts3');
    expect(result.bucket.total_used).toBe(30);
  });
});

// -----------------------------------------------------------------------------
// updateBucket tests - anomaly detection (used decreases)
// -----------------------------------------------------------------------------

describe('updateBucket - anomalies', () => {
  it('detects anomaly when used decreases without reset change', () => {
    const bucket = makeBucket({ last_used: 100, total_used: 50 });
    const sample = makeSample({ used: 80, reset: bucket.last_reset }); // decreased!

    const result = updateBucket(bucket, sample, '2026-01-25T12:00:30.000Z');

    expect(result.anomaly).toBe(true);
    expect(result.delta).toBe(0); // do not subtract
    expect(result.bucket.anomalies).toBe(1);
    expect(result.bucket.total_used).toBe(50); // unchanged
  });

  it('increments anomaly counter on multiple anomalies', () => {
    const bucket = makeBucket({ last_used: 100, anomalies: 2 });
    const reset = bucket.last_reset;

    const result = updateBucket(bucket, makeSample({ used: 50, reset }), 'ts');

    expect(result.bucket.anomalies).toBe(3);
  });

  it('updates last_used even on anomaly', () => {
    const bucket = makeBucket({ last_used: 100 });
    const sample = makeSample({ used: 50, reset: bucket.last_reset });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.last_used).toBe(50);
  });
});

// -----------------------------------------------------------------------------
// updateBucket tests - reset boundary transition
// -----------------------------------------------------------------------------

describe('updateBucket - reset boundary', () => {
  it('includes post-reset used count on window change', () => {
    const bucket = makeBucket({ last_used: 4500, total_used: 200, last_reset: 1706200000 });
    const newReset = 1706203600; // 1 hour later
    const sample = makeSample({ used: 25, reset: newReset }); // 25 used in new window

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.window_crossed).toBe(true);
    expect(result.bucket.windows_crossed).toBe(1);
    expect(result.bucket.total_used).toBe(225); // 200 + 25
    expect(result.bucket.last_reset).toBe(newReset);
    expect(result.bucket.last_used).toBe(25);
  });

  it('handles multiple window crosses', () => {
    let bucket = makeBucket({ windows_crossed: 0 });

    // First window change
    let result = updateBucket(
      bucket,
      makeSample({ used: 10, reset: bucket.last_reset + 3600 }),
      'ts1'
    );
    expect(result.bucket.windows_crossed).toBe(1);
    bucket = result.bucket;

    // Second window change
    result = updateBucket(
      bucket,
      makeSample({ used: 5, reset: bucket.last_reset + 3600 }),
      'ts2'
    );
    expect(result.bucket.windows_crossed).toBe(2);
  });

  it('resets last_used to new window value', () => {
    const bucket = makeBucket({ last_used: 4999 });
    const sample = makeSample({ used: 10, reset: bucket.last_reset + 3600 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.last_used).toBe(10);
  });
});

// -----------------------------------------------------------------------------
// reduce tests (full response processing)
// -----------------------------------------------------------------------------

describe('reduce', () => {
  it('initializes new buckets on first poll', () => {
    const state = makeState();
    const response = makeResponse({
      core: makeSample({ used: 100 }),
      search: makeSample({ used: 5 }),
    });

    const { state: newState } = reduce(state, response, 'ts');

    expect(Object.keys(newState.buckets)).toHaveLength(2);
    expect(newState.buckets['core']?.total_used).toBe(0);
    expect(newState.buckets['search']?.total_used).toBe(0);
    expect(newState.poll_count).toBe(1);
  });

  it('updates existing buckets on subsequent polls', () => {
    const state = makeState({
      buckets: {
        core: makeBucket({ last_used: 100, total_used: 50 }),
      },
      poll_count: 1,
    });
    const response = makeResponse({
      core: makeSample({ used: 150, reset: state.buckets['core']!.last_reset }),
    });

    const { state: newState } = reduce(state, response, 'ts');

    expect(newState.buckets['core']?.total_used).toBe(100);
    expect(newState.poll_count).toBe(2);
  });

  it('handles mix of new and existing buckets', () => {
    const state = makeState({
      buckets: {
        core: makeBucket({ last_used: 100, total_used: 50 }),
      },
    });
    const response = makeResponse({
      core: makeSample({ used: 110, reset: state.buckets['core']!.last_reset }),
      graphql: makeSample({ used: 20 }),
    });

    const { state: newState } = reduce(state, response, 'ts');

    expect(Object.keys(newState.buckets)).toHaveLength(2);
    expect(newState.buckets['core']?.total_used).toBe(60);
    expect(newState.buckets['graphql']?.total_used).toBe(0); // new bucket, baseline
  });

  it('preserves buckets not in current response', () => {
    const state = makeState({
      buckets: {
        core: makeBucket({ total_used: 100 }),
        search: makeBucket({ total_used: 50 }),
      },
    });
    // Response only includes core
    const response = makeResponse({
      core: makeSample({ used: 110, reset: state.buckets['core']!.last_reset }),
    });

    const { state: newState } = reduce(state, response, 'ts');

    expect(newState.buckets['search']?.total_used).toBe(50);
  });
});

// -----------------------------------------------------------------------------
// recordFailure tests
// -----------------------------------------------------------------------------

describe('recordFailure', () => {
  it('increments poll_failures and sets last_error', () => {
    const state = makeState({ poll_failures: 2 });

    const newState = recordFailure(state, 'Network error');

    expect(newState.poll_failures).toBe(3);
    expect(newState.last_error).toBe('Network error');
  });

  it('preserves existing bucket state', () => {
    const state = makeState({
      buckets: { core: makeBucket({ total_used: 100 }) },
    });

    const newState = recordFailure(state, 'Error');

    expect(newState.buckets['core']?.total_used).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// markStopped tests
// -----------------------------------------------------------------------------

describe('markStopped', () => {
  it('sets stopped_at_ts', () => {
    const state = makeState({ stopped_at_ts: null });

    const newState = markStopped(state);

    expect(newState.stopped_at_ts).not.toBeNull();
    expect(typeof newState.stopped_at_ts).toBe('string');
  });

  it('preserves all other state', () => {
    const state = makeState({
      poll_count: 10,
      buckets: { core: makeBucket({ total_used: 500 }) },
    });

    const newState = markStopped(state);

    expect(newState.poll_count).toBe(10);
    expect(newState.buckets['core']?.total_used).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// updateBucket tests - idle window expiry (reset changes, no real usage)
// -----------------------------------------------------------------------------

describe('updateBucket - idle window expiry', () => {
  it('scenario 1: window expires with 0 usage both sides → no crossing, no usage', () => {
    const bucket = makeBucket({
      last_reset: 1000,
      last_used: 0,
      total_used: 0,
      windows_crossed: 0,
    });
    const sample = makeSample({ used: 0, reset: 1060 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.total_used).toBe(0);
    expect(result.bucket.windows_crossed).toBe(0);
    expect(result.delta).toBe(0);
    expect(result.window_crossed).toBe(false);
  });

  it('scenario 2: window expires with stable nonzero usage → no crossing, no new usage', () => {
    const bucket = makeBucket({
      last_reset: 1000,
      last_used: 5,
      total_used: 0,
      windows_crossed: 0,
    });
    const sample = makeSample({ used: 5, reset: 1060 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.total_used).toBe(0);
    expect(result.bucket.windows_crossed).toBe(0);
    expect(result.delta).toBe(0);
    expect(result.window_crossed).toBe(false);
  });

  it('scenario 3: reset change + usage increased → delta applied, no crossing', () => {
    const bucket = makeBucket({
      last_reset: 1000,
      last_used: 5,
      total_used: 10,
      windows_crossed: 0,
    });
    const sample = makeSample({ used: 10, reset: 1060 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.total_used).toBe(15); // 10 + delta(5)
    expect(result.bucket.windows_crossed).toBe(0);
    expect(result.delta).toBe(5);
    expect(result.window_crossed).toBe(false);
  });

  it('scenario 4: genuine crossing — used drops', () => {
    const bucket = makeBucket({
      last_reset: 1000,
      last_used: 150,
      total_used: 200,
      windows_crossed: 0,
    });
    const sample = makeSample({ used: 3, reset: 4600 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.total_used).toBe(203); // 200 + 3
    expect(result.bucket.windows_crossed).toBe(1);
    expect(result.delta).toBe(3);
    expect(result.window_crossed).toBe(true);
  });

  it('scenario 5: genuine crossing — used drops to 0', () => {
    const bucket = makeBucket({
      last_reset: 1000,
      last_used: 100,
      total_used: 100,
      windows_crossed: 0,
    });
    const sample = makeSample({ used: 0, reset: 4600 });

    const result = updateBucket(bucket, sample, 'ts');

    expect(result.bucket.total_used).toBe(100); // 100 + 0
    expect(result.bucket.windows_crossed).toBe(1);
    expect(result.delta).toBe(0);
    expect(result.window_crossed).toBe(true);
  });

  it('scenario 6: multi-poll through genuine crossing', () => {
    let bucket = makeBucket({
      last_reset: 1000,
      last_used: 100,
      total_used: 0,
      windows_crossed: 0,
    });

    // Poll 1: same window, used goes 100 → 100 (baseline was 100)
    // Actually let's start from init state perspective
    // Poll 1: used=100, reset=1000 → same window, delta = 0
    let result = updateBucket(bucket, makeSample({ used: 100, reset: 1000 }), 'ts1');
    expect(result.bucket.total_used).toBe(0);
    bucket = result.bucket;

    // Poll 2: used=150, reset=1000 → same window, delta = 50
    result = updateBucket(bucket, makeSample({ used: 150, reset: 1000 }), 'ts2');
    expect(result.bucket.total_used).toBe(50);
    bucket = result.bucket;

    // Poll 3: used=3, reset=4600 → genuine crossing, delta = 3
    result = updateBucket(bucket, makeSample({ used: 3, reset: 4600 }), 'ts3');
    expect(result.bucket.total_used).toBe(53); // 50 + 3
    expect(result.bucket.windows_crossed).toBe(1);
  });

  it('scenario 7: multi-poll through idle expiry — no crossing ever', () => {
    let bucket = makeBucket({
      last_reset: 1000,
      last_used: 0,
      total_used: 0,
      windows_crossed: 0,
    });

    // Poll 1: used=0, reset=1000 → same window, delta = 0
    let result = updateBucket(bucket, makeSample({ used: 0, reset: 1000 }), 'ts1');
    expect(result.bucket.total_used).toBe(0);
    expect(result.bucket.windows_crossed).toBe(0);
    bucket = result.bucket;

    // Poll 2: used=0, reset=1060 → window expired (idle), NO crossing
    result = updateBucket(bucket, makeSample({ used: 0, reset: 1060 }), 'ts2');
    expect(result.bucket.total_used).toBe(0);
    expect(result.bucket.windows_crossed).toBe(0);
    bucket = result.bucket;

    // Poll 3: used=0, reset=1120 → another idle expiry, still NO crossing
    result = updateBucket(bucket, makeSample({ used: 0, reset: 1120 }), 'ts3');
    expect(result.bucket.total_used).toBe(0);
    expect(result.bucket.windows_crossed).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// createInitialState tests
// -----------------------------------------------------------------------------

describe('createInitialState', () => {
  it('creates empty state with correct defaults', () => {
    const state = createInitialState();

    expect(state.buckets).toEqual({});
    expect(state.poll_count).toBe(0);
    expect(state.poll_failures).toBe(0);
    expect(state.stopped_at_ts).toBeNull();
    expect(state.last_error).toBeNull();
    expect(state.interval_seconds).toBe(30);
    expect(typeof state.started_at_ts).toBe('string');
  });
});
