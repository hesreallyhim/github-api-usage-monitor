/**
 * Reducer
 * Layer: core
 *
 * Provided ports:
 *   - reducer.update
 *   - reducer.initBucket
 *
 * Pure business logic for rate-limit reduction.
 * Maintains constant-space per-bucket state.
 *
 * Algorithm (per poll, per bucket):
 *   if bucket not initialized:
 *     initialize with current reset/used
 *   else if reset changed AND used < last_used (genuine window reset):
 *     windows_crossed += 1
 *     total_used += used (include post-reset usage)
 *     last_reset = reset
 *   else if reset changed AND used >= last_used (timestamp rotation, not a real reset):
 *     delta = used - last_used
 *     total_used += delta
 *     last_reset = reset
 *   else (same window):
 *     delta = used - last_used
 *     if delta < 0: anomaly (do not subtract)
 *     else: total_used += delta
 *   last_used = used
 */

import type { ReducerState, BucketState, RateLimitSample, RateLimitResponse } from './types';
import { POLL_INTERVAL_SECONDS } from './types';

// -----------------------------------------------------------------------------
// Port: reducer.initBucket
// -----------------------------------------------------------------------------

/**
 * Initializes a new bucket state from the first sample.
 */
export function initBucket(sample: RateLimitSample, timestamp: string): BucketState {
  return {
    last_reset: sample.reset,
    last_used: sample.used,
    total_used: 0, // First sample is baseline, not counted
    windows_crossed: 0,
    anomalies: 0,
    last_seen_ts: timestamp,
    limit: sample.limit,
    remaining: sample.remaining,
  };
}

// -----------------------------------------------------------------------------
// Port: reducer.update
// -----------------------------------------------------------------------------

export interface UpdateResult {
  /** Updated bucket state */
  bucket: BucketState;
  /** Delta applied this poll (0 if anomaly or boundary) */
  delta: number;
  /** True if an anomaly was detected */
  anomaly: boolean;
  /** True if a window boundary was crossed */
  window_crossed: boolean;
}

/**
 * Updates a bucket state with a new sample.
 * Pure function - returns new state without mutating input.
 *
 * @param bucket - Current bucket state
 * @param sample - New rate limit sample
 * @param timestamp - ISO timestamp of observation
 */
export function updateBucket(
  bucket: BucketState,
  sample: RateLimitSample,
  timestamp: string,
): UpdateResult {
  const resetChanged = sample.reset !== bucket.last_reset;
  const usedDecreased = sample.used < bucket.last_used;

  // Genuine window reset: reset timestamp changed AND used count dropped.
  // This means the rate-limit window actually rolled over and the counter reset.
  if (resetChanged && usedDecreased) {
    return {
      bucket: {
        last_reset: sample.reset,
        last_used: sample.used,
        total_used: bucket.total_used + sample.used,
        windows_crossed: bucket.windows_crossed + 1,
        anomalies: bucket.anomalies,
        last_seen_ts: timestamp,
        limit: sample.limit,
        remaining: sample.remaining,
      },
      delta: sample.used,
      anomaly: false,
      window_crossed: true,
    };
  }

  // Reset timestamp rotated but used didn't drop (e.g. GitHub rotating
  // timestamps on unused buckets, or continued usage across a boundary).
  // Treat as a normal delta — update last_reset but don't count a crossing.
  if (resetChanged) {
    const delta = sample.used - bucket.last_used;
    return {
      bucket: {
        last_reset: sample.reset,
        last_used: sample.used,
        total_used: bucket.total_used + delta,
        windows_crossed: bucket.windows_crossed,
        anomalies: bucket.anomalies,
        last_seen_ts: timestamp,
        limit: sample.limit,
        remaining: sample.remaining,
      },
      delta,
      anomaly: false,
      window_crossed: false,
    };
  }

  // Same window: calculate delta
  const delta = sample.used - bucket.last_used;

  if (delta < 0) {
    // Anomaly: used decreased without reset change
    return {
      bucket: {
        ...bucket,
        last_used: sample.used,
        anomalies: bucket.anomalies + 1,
        last_seen_ts: timestamp,
        limit: sample.limit,
        remaining: sample.remaining,
      },
      delta: 0,
      anomaly: true,
      window_crossed: false,
    };
  }

  // Normal case: accumulate delta
  return {
    bucket: {
      ...bucket,
      last_used: sample.used,
      total_used: bucket.total_used + delta,
      last_seen_ts: timestamp,
      limit: sample.limit,
      remaining: sample.remaining,
    },
    delta,
    anomaly: false,
    window_crossed: false,
  };
}

// -----------------------------------------------------------------------------
// State factory
// -----------------------------------------------------------------------------

/**
 * Creates initial reducer state.
 */
export function createInitialState(): ReducerState {
  return {
    buckets: {},
    started_at_ts: new Date().toISOString(),
    stopped_at_ts: null,
    poller_started_at_ts: null,
    interval_seconds: POLL_INTERVAL_SECONDS,
    poll_count: 0,
    poll_failures: 0,
    last_error: null,
  };
}

// -----------------------------------------------------------------------------
// Full reducer
// -----------------------------------------------------------------------------

export interface ReduceResult {
  /** Updated global state */
  state: ReducerState;
  /** Per-bucket update results */
  updates: Record<string, UpdateResult>;
}

/**
 * Processes a full rate limit response and updates state.
 * Pure function - returns new state without mutating input.
 *
 * @param state - Current reducer state
 * @param response - Rate limit API response
 * @param timestamp - ISO timestamp of observation
 */
export function reduce(
  state: ReducerState,
  response: RateLimitResponse,
  timestamp: string,
): ReduceResult {
  const newBuckets: Record<string, BucketState> = { ...state.buckets };
  const updates: Record<string, UpdateResult> = {};

  // Process each bucket in the response
  for (const [name, sample] of Object.entries(response.resources)) {
    const existingBucket = state.buckets[name];

    if (!existingBucket) {
      // New bucket: initialize
      const bucket = initBucket(sample, timestamp);
      newBuckets[name] = bucket;
      updates[name] = {
        bucket,
        delta: 0,
        anomaly: false,
        window_crossed: false,
      };
    } else {
      // Existing bucket: update
      const result = updateBucket(existingBucket, sample, timestamp);
      newBuckets[name] = result.bucket;
      updates[name] = result;
    }
  }

  return {
    state: {
      ...state,
      buckets: newBuckets,
      poll_count: state.poll_count + 1,
    },
    updates,
  };
}

/**
 * Records a poll failure in state.
 * Pure function - returns new state.
 */
export function recordFailure(state: ReducerState, error: string): ReducerState {
  return {
    ...state,
    poll_failures: state.poll_failures + 1,
    last_error: error,
  };
}

/**
 * Marks state as stopped.
 */
export function markStopped(state: ReducerState): ReducerState {
  return {
    ...state,
    stopped_at_ts: new Date().toISOString(),
  };
}
