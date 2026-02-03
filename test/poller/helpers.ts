/**
 * Shared test helpers for poller test modules.
 */

import type { BucketState, ReducerState } from '../../src/types';
import { POLL_INTERVAL_SECONDS } from '../../src/types';

export function makeBucket(overrides: Partial<BucketState> = {}): BucketState {
  return {
    last_reset: 1706200000,
    last_used: 0,
    total_used: 0,
    windows_crossed: 0,
    anomalies: 0,
    last_seen_ts: '2025-01-25T12:00:00Z',
    limit: 5000,
    remaining: 5000,
    ...overrides,
  };
}

export function makeState(buckets: Record<string, BucketState> = {}): ReducerState {
  return {
    buckets,
    started_at_ts: '2025-01-25T12:00:00Z',
    stopped_at_ts: null,
    poller_started_at_ts: '2025-01-25T12:00:00Z',
    interval_seconds: POLL_INTERVAL_SECONDS,
    poll_count: 5,
    poll_failures: 0,
    last_error: null,
  };
}

export const BASE_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000; // 30_000
export const NOW = 1706200000;
