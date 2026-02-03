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
/**
 * Initializes a new bucket state from the first sample.
 */
export declare function initBucket(sample: RateLimitSample, timestamp: string): BucketState;
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
export declare function updateBucket(bucket: BucketState, sample: RateLimitSample, timestamp: string): UpdateResult;
/**
 * Creates initial reducer state.
 */
export declare function createInitialState(): ReducerState;
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
export declare function reduce(state: ReducerState, response: RateLimitResponse, timestamp: string): ReduceResult;
/**
 * Records a poll failure in state.
 * Pure function - returns new state.
 */
export declare function recordFailure(state: ReducerState, error: string): ReducerState;
/**
 * Marks state as stopped.
 */
export declare function markStopped(state: ReducerState): ReducerState;
