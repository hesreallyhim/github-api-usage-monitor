/**
 * Rate Limit Control
 * Layer: poller
 *
 * Pure logic for handling 403/429 responses and gating poll cadence.
 *
 * Based on guidance in current docs at time of writing:
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#exceeding-the-rate-limit
 */

import type { RateLimitErrorDetails } from '../github';
import type { PollLogEntry, RateLimitErrorKind, PollLogError } from '../types';
import type { SleepPlan } from './sleep-plan';

export const MAX_SECONDARY_RETRIES = 5;
export const SECONDARY_DEFAULT_WAIT_MS = 60_000;

export interface RateLimitControlState {
  blocked_until_ms: number | null;
  secondary_consecutive: number;
}

export interface RateLimitEvent {
  kind: RateLimitErrorKind;
  details: RateLimitErrorDetails;
}

export interface RateLimitDecision {
  state: RateLimitControlState;
  kind: RateLimitErrorKind;
  next_allowed_at_ms: number | null;
  wait_ms: number | null;
  secondary_retry_count: number;
  fatal: boolean;
}

export interface RateLimitGateResult extends SleepPlan {
  blocked: boolean;
}

export function createRateLimitControlState(): RateLimitControlState {
  return { blocked_until_ms: null, secondary_consecutive: 0 };
}

export function resetRateLimitControl(state: RateLimitControlState): RateLimitControlState {
  return { ...state, blocked_until_ms: null, secondary_consecutive: 0 };
}

export function classifyRateLimitError(details: RateLimitErrorDetails): RateLimitErrorKind | null {
  if (details.status !== 403 && details.status !== 429) {
    return null;
  }

  const message = (details.message ?? '').toLowerCase();
  if (message.includes('secondary') || message.includes('abuse')) {
    return 'secondary';
  }

  // "If you exceed your primary rate limit, you will receive a 403 or 429 response, and the x-ratelimit-remaining header will be 0."
  if (details.rate_limit_remaining === 0) {
    return 'primary';
  }

  return 'unknown';
}

export function handleRateLimitError(
  state: RateLimitControlState,
  event: RateLimitEvent,
  nowMs: number,
): RateLimitDecision {
  const { details, kind } = event;

  const candidates: number[] = [nowMs + SECONDARY_DEFAULT_WAIT_MS];

  // Independent checks (no else-if) so we can honor multiple constraints together.
  // "If the retry-after response header is present, you should not retry your request until after that many seconds has elapsed."
  if (details.retry_after_seconds !== null) {
    candidates.push(nowMs + details.retry_after_seconds * 1000);
  }

  // "If the x-ratelimit-remaining header is 0"
  if (details.rate_limit_remaining === 0 && details.rate_limit_reset !== null) {
    // "You should not retry your request until after the time specified by the x-ratelimit-reset header."
    candidates.push(details.rate_limit_reset * 1000);
  }

  const baseAllowedAt = Math.max(...candidates);

  if (kind === 'secondary') {
    const secondaryRetryCount = state.secondary_consecutive + 1;
    const baseDelayMs = Math.max(0, baseAllowedAt - nowMs);

    // "If your request continues to fail due to a secondary rate limit, wait for an exponentially increasing amount of time between retries."
    const multiplier = Math.pow(2, secondaryRetryCount - 1);
    const waitMs = baseDelayMs * multiplier;
    const nextAllowedAtMs = nowMs + waitMs;

    // "throw an error after a specific number of retries."
    const fatal = secondaryRetryCount >= MAX_SECONDARY_RETRIES;

    return {
      state: { blocked_until_ms: nextAllowedAtMs, secondary_consecutive: secondaryRetryCount },
      kind,
      next_allowed_at_ms: nextAllowedAtMs,
      wait_ms: waitMs,
      secondary_retry_count: secondaryRetryCount,
      fatal,
    };
  }

  if (kind === 'primary') {
    const nextAllowedAtMs =
      details.rate_limit_reset !== null ? details.rate_limit_reset * 1000 : baseAllowedAt;
    const waitMs = Math.max(0, nextAllowedAtMs - nowMs);

    return {
      state: { blocked_until_ms: nextAllowedAtMs, secondary_consecutive: 0 },
      kind,
      next_allowed_at_ms: nextAllowedAtMs,
      wait_ms: waitMs,
      secondary_retry_count: 0,
      fatal: false,
    };
  }

  // "Otherwise, wait for at least one minute before retrying."
  const nextAllowedAtMs = baseAllowedAt;
  const waitMs = Math.max(0, nextAllowedAtMs - nowMs);
  return {
    state: { blocked_until_ms: nextAllowedAtMs, secondary_consecutive: 0 },
    kind,
    next_allowed_at_ms: nextAllowedAtMs,
    wait_ms: waitMs,
    secondary_retry_count: 0,
    fatal: false,
  };
}

export function applyRateLimitGate(
  plan: SleepPlan,
  controlState: RateLimitControlState,
  nowMs: number,
): RateLimitGateResult {
  const blockedUntil = controlState.blocked_until_ms;
  if (!blockedUntil || blockedUntil <= nowMs) {
    return { ...plan, blocked: false };
  }

  const waitMs = Math.max(plan.sleepMs, blockedUntil - nowMs);
  return {
    sleepMs: waitMs,
    burst: false,
    burstGapMs: plan.burstGapMs,
    blocked: true,
  };
}

export function buildRateLimitErrorEntry(
  event: RateLimitEvent,
  pollNumber: number,
  timestamp: string,
  decision: RateLimitDecision,
): PollLogEntry {
  const error: PollLogError = {
    kind: event.kind,
    status: event.details.status,
    message: event.details.message ?? null,
    retry_after_seconds: event.details.retry_after_seconds,
    rate_limit_remaining: event.details.rate_limit_remaining,
    rate_limit_reset: event.details.rate_limit_reset,
    next_allowed_at:
      decision.next_allowed_at_ms !== null ? Math.ceil(decision.next_allowed_at_ms / 1000) : null,
    secondary_retry_count: decision.secondary_retry_count,
  };

  return {
    timestamp,
    poll_number: pollNumber,
    buckets: {},
    error,
  };
}
