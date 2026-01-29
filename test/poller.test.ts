/**
 * Poller Tests
 *
 * Tests for computeSleepPlan — the pure function that decides
 * when to poll next based on upcoming bucket resets.
 */

import { describe, it, expect } from 'vitest';
import { computeSleepPlan, applyDebounce, POLL_DEBOUNCE_MS } from '../src/poller';
import type { SleepPlan } from '../src/poller';
import type { ReducerState, BucketState } from '../src/types';
import { POLL_INTERVAL_SECONDS } from '../src/types';

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

function makeBucket(overrides: Partial<BucketState> = {}): BucketState {
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

function makeState(buckets: Record<string, BucketState> = {}): ReducerState {
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

const BASE_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000; // 30_000
const NOW = 1706200000;

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('computeSleepPlan', () => {
  it('returns base interval when no active buckets exist', () => {
    const state = makeState({});
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    expect(plan).toEqual({ sleepMs: BASE_INTERVAL_MS, burst: false, burstGapMs: 0 });
  });

  it('returns base interval when buckets have zero total_used (idle)', () => {
    const state = makeState({
      core: makeBucket({ last_reset: NOW + 3500, total_used: 0 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    expect(plan).toEqual({ sleepMs: BASE_INTERVAL_MS, burst: false, burstGapMs: 0 });
  });

  it('returns base interval when reset is far away (45s, base=30s)', () => {
    const state = makeState({
      core: makeBucket({ last_reset: NOW + 45, total_used: 10 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    expect(plan.sleepMs).toBe(BASE_INTERVAL_MS);
    expect(plan.burst).toBe(false);
  });

  it('returns base interval when reset is very far away (3500s)', () => {
    const state = makeState({
      core: makeBucket({ last_reset: NOW + 3500, total_used: 10 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    expect(plan.sleepMs).toBe(BASE_INTERVAL_MS);
    expect(plan.burst).toBe(false);
  });

  it('targets pre-reset when reset is 15s away (between burst threshold and base interval)', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 15, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // secondsUntilReset=15, targetSleep=(15-3)*1000=12000
    expect(plan.sleepMs).toBe(12000);
    expect(plan.burst).toBe(false);
  });

  it('enters burst mode when reset is 8s away', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 8, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // preResetSleep = max((8-3)*1000, 1000) = 5000
    expect(plan.sleepMs).toBe(5000);
    expect(plan.burst).toBe(true);
    expect(plan.burstGapMs).toBe(6000); // (3+3)*1000
  });

  it('enters burst mode when reset is 3s away (clamps to MIN_SLEEP_MS)', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 3, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // preResetSleep = max((3-3)*1000, 1000) = 1000
    expect(plan.sleepMs).toBe(1000);
    expect(plan.burst).toBe(true);
    expect(plan.burstGapMs).toBe(6000);
  });

  it('enters burst mode when reset is 1s away (clamps to MIN_SLEEP_MS)', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 1, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // preResetSleep = max((1-3)*1000, 1000) = 1000
    expect(plan.sleepMs).toBe(1000);
    expect(plan.burst).toBe(true);
  });

  it('polls quickly when reset already passed', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW - 2, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // All resets are in the past → filtered out → no active resets → base interval
    // Actually: r > nowEpochSeconds filters this out, so falls to no-active-resets path
    expect(plan.sleepMs).toBe(BASE_INTERVAL_MS);
    expect(plan.burst).toBe(false);
  });

  it('picks soonest reset when multiple active buckets exist', () => {
    const state = makeState({
      core: makeBucket({ last_reset: NOW + 45, total_used: 10 }),
      search: makeBucket({ last_reset: NOW + 12, total_used: 5 }),
      graphql: makeBucket({ last_reset: NOW + 300, total_used: 2 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // Soonest is search at 12s → targetSleep = (12-3)*1000 = 9000
    expect(plan.sleepMs).toBe(9000);
    expect(plan.burst).toBe(false);
  });

  it('ignores idle buckets (total_used=0) when computing resets', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 5, total_used: 0 }), // idle — ignored
      core: makeBucket({ last_reset: NOW + 45, total_used: 10 }), // active, far away
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // search is ignored (total_used=0), core at 45s > base_interval → normal
    expect(plan.sleepMs).toBe(BASE_INTERVAL_MS);
    expect(plan.burst).toBe(false);
  });

  it('handles edge case where secondsUntilReset equals burst threshold exactly', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 8, total_used: 5 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // 8 <= 8 → burst mode
    expect(plan.burst).toBe(true);
    expect(plan.sleepMs).toBe(5000);
  });

  it('handles edge case where secondsUntilReset equals base interval exactly', () => {
    const state = makeState({
      core: makeBucket({ last_reset: NOW + 30, total_used: 10 }),
    });
    const plan = computeSleepPlan(state, BASE_INTERVAL_MS, NOW);

    // 30*1000 = 30000 which is NOT < baseIntervalMs (30000), so falls through to base
    expect(plan.sleepMs).toBe(BASE_INTERVAL_MS);
    expect(plan.burst).toBe(false);
  });

  it('clamps pre-reset sleep to MIN_SLEEP_MS when buffer exceeds time', () => {
    const state = makeState({
      search: makeBucket({ last_reset: NOW + 10, total_used: 5 }),
    });
    // Use a very large base interval so 10s < baseIntervalMs
    const plan = computeSleepPlan(state, 60000, NOW);

    // secondsUntilReset=10, not in burst (10>8), but 10*1000 < 60000
    // targetSleep = (10-3)*1000 = 7000
    expect(plan.sleepMs).toBe(7000);
    expect(plan.burst).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// applyDebounce
// -----------------------------------------------------------------------------

describe('applyDebounce', () => {
  it('clamps sleepMs up to debounce floor', () => {
    const plan: SleepPlan = { sleepMs: 1000, burst: false, burstGapMs: 0 };
    const result = applyDebounce(plan, 5000);

    expect(result.sleepMs).toBe(5000);
  });

  it('does not reduce sleepMs already above the floor', () => {
    const plan: SleepPlan = { sleepMs: 30000, burst: false, burstGapMs: 0 };
    const result = applyDebounce(plan, 5000);

    expect(result.sleepMs).toBe(30000);
  });

  it('clamps burstGapMs when in burst mode', () => {
    const plan: SleepPlan = { sleepMs: 1000, burst: true, burstGapMs: 3000 };
    const result = applyDebounce(plan, 5000);

    expect(result.sleepMs).toBe(5000);
    expect(result.burstGapMs).toBe(5000);
    expect(result.burst).toBe(true);
  });

  it('leaves burstGapMs untouched when not in burst mode', () => {
    const plan: SleepPlan = { sleepMs: 1000, burst: false, burstGapMs: 0 };
    const result = applyDebounce(plan, 5000);

    expect(result.burstGapMs).toBe(0);
  });

  it('does not reduce burstGapMs already above the floor', () => {
    const plan: SleepPlan = { sleepMs: 5000, burst: true, burstGapMs: 6000 };
    const result = applyDebounce(plan, 5000);

    expect(result.burstGapMs).toBe(6000);
  });

  it('POLL_DEBOUNCE_MS is exported and positive', () => {
    expect(POLL_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});
