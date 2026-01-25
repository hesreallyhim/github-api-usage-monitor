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
 *   else if reset == last_reset (same window):
 *     delta = used - last_used
 *     if delta < 0: anomaly (do not subtract)
 *     else: total_used += delta
 *   else (new window):
 *     windows_crossed += 1
 *     total_used += used (include post-reset usage)
 *     last_reset = reset
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
  timestamp: string
): UpdateResult {
  // TODO: Implement
  // - Check if reset changed (window boundary)
  // - Calculate delta if same window
  // - Detect anomalies (delta < 0)
  // - Return updated state and metadata
  throw new Error('Not implemented: reducer.updateBucket');
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
  timestamp: string
): ReduceResult {
  // TODO: Implement
  // - Iterate over all buckets in response.resources
  // - For each bucket: initBucket or updateBucket
  // - Increment poll_count
  // - Return new state and per-bucket results
  throw new Error('Not implemented: reducer.reduce');
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
