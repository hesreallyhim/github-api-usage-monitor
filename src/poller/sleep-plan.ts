/**
 * Adaptive Sleep Planning
 *
 * Pure functions for computing when to poll next based on upcoming bucket resets.
 * Extracted from poller.ts for testability.
 */

import type { ReducerState } from '../types';

// -----------------------------------------------------------------------------
// Adaptive sleep planning
// -----------------------------------------------------------------------------

export interface SleepPlan {
  /** Milliseconds to sleep before next poll */
  sleepMs: number;
  /** If true, perform a second poll shortly after the first (burst mode) */
  burst: boolean;
  /** If burst, milliseconds to sleep between the two polls */
  burstGapMs: number;
}

const BURST_THRESHOLD_S = 8;
const PRE_RESET_BUFFER_S = 3;
const POST_RESET_DELAY_S = 3;
const MIN_SLEEP_MS = 1000;

/**
 * Computes when to poll next based on upcoming bucket resets.
 *
 * Instead of a fixed interval, this targets polls just before bucket resets
 * to minimize the uncertainty window — the gap between the last pre-reset
 * observation and the actual reset.
 *
 * When a reset is imminent (≤8s away), enters "burst mode": two polls
 * bracket the reset boundary to capture both pre-reset and post-reset state.
 */
export function computeSleepPlan(
  state: ReducerState,
  baseIntervalMs: number,
  nowEpochSeconds: number,
): SleepPlan {
  const activeResets = Object.values(state.buckets)
    .filter((b) => b.total_used > 0)
    .map((b) => b.last_reset)
    .filter((r) => r > nowEpochSeconds);

  if (activeResets.length === 0) {
    return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
  }

  const soonestReset = Math.min(...activeResets);
  const secondsUntilReset = soonestReset - nowEpochSeconds;

  if (secondsUntilReset <= 0) {
    // Reset already passed — poll quickly to pick up new window
    return { sleepMs: Math.min(2000, baseIntervalMs), burst: false, burstGapMs: 0 };
  }

  if (secondsUntilReset <= BURST_THRESHOLD_S) {
    // Close to reset — burst mode: poll before and after
    const preResetSleep = Math.max((secondsUntilReset - PRE_RESET_BUFFER_S) * 1000, MIN_SLEEP_MS);
    const burstGap = (PRE_RESET_BUFFER_S + POST_RESET_DELAY_S) * 1000;
    return { sleepMs: preResetSleep, burst: true, burstGapMs: burstGap };
  }

  if (secondsUntilReset * 1000 < baseIntervalMs) {
    // Reset coming before next regular poll — target pre-reset
    const targetSleep = (secondsUntilReset - PRE_RESET_BUFFER_S) * 1000;
    return { sleepMs: Math.max(targetSleep, MIN_SLEEP_MS), burst: false, burstGapMs: 0 };
  }

  return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
}

// -----------------------------------------------------------------------------
// Poll debounce
// -----------------------------------------------------------------------------

/**
 * Minimum milliseconds between any two polls.
 *
 * Prevents rapid-fire polling when multiple buckets have staggered resets
 * close together (e.g. three 60s buckets resetting 5s apart). Without this,
 * each reset triggers its own burst, producing 6 polls in ~15s. The debounce
 * floors every sleep so back-to-back bursts collapse naturally.
 *
 * Tunable independently from computeSleepPlan's reset-targeting logic.
 */
export const POLL_DEBOUNCE_MS = 5000;

/**
 * Applies a minimum-interval debounce to a sleep plan.
 * Clamps both the initial sleep and the burst gap (if any) so that no
 * two polls can occur closer than `debounceMs` apart.
 */
export function applyDebounce(plan: SleepPlan, debounceMs: number): SleepPlan {
  return {
    ...plan,
    sleepMs: Math.max(plan.sleepMs, debounceMs),
    burstGapMs: plan.burst ? Math.max(plan.burstGapMs, debounceMs) : plan.burstGapMs,
  };
}
