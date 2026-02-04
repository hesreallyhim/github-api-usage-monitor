/**
 * Tests for rate-limit control logic.
 */

import { describe, it, expect } from 'vitest';
import {
  applyRateLimitGate,
  classifyRateLimitError,
  createRateLimitControlState,
  handleRateLimitError,
} from '../../src/poller/rate-limit-control';
import type { RateLimitEvent } from '../../src/poller/rate-limit-control';

function makeDetails(
  overrides: Partial<RateLimitEvent['details']> = {},
): RateLimitEvent['details'] {
  return {
    status: 429,
    message: null,
    rate_limit_remaining: null,
    rate_limit_reset: null,
    retry_after_seconds: null,
    ...overrides,
  };
}

describe('classifyRateLimitError', () => {
  it('classifies secondary when message contains secondary or abuse', () => {
    const secondary = classifyRateLimitError(
      makeDetails({ status: 429, message: 'Secondary rate limit exceeded' }),
    );
    const abuse = classifyRateLimitError(makeDetails({ status: 403, message: 'Abuse detected' }));

    expect(secondary).toBe('secondary');
    expect(abuse).toBe('secondary');
  });

  it('classifies primary when remaining is 0 and no secondary marker', () => {
    const kind = classifyRateLimitError(
      makeDetails({ status: 403, rate_limit_remaining: 0, message: 'Forbidden' }),
    );

    expect(kind).toBe('primary');
  });

  it('returns null for non-403/429 statuses', () => {
    const kind = classifyRateLimitError(makeDetails({ status: 500 }));

    expect(kind).toBeNull();
  });
});

describe('handleRateLimitError', () => {
  it('honors retry-after and reset with independent checks (takes max)', () => {
    const nowMs = 1_700_000_000_000;
    const details = makeDetails({
      status: 429,
      message: 'Secondary rate limit exceeded',
      retry_after_seconds: 30,
      rate_limit_remaining: 0,
      rate_limit_reset: Math.floor((nowMs + 90_000) / 1000),
    });

    const event: RateLimitEvent = { kind: 'secondary', details };
    const decision = handleRateLimitError(createRateLimitControlState(), event, nowMs);

    expect(decision.secondary_retry_count).toBe(1);
    expect(decision.wait_ms).toBe(90_000);
    expect(decision.next_allowed_at_ms).toBe(nowMs + 90_000);
  });

  it('applies exponential backoff for consecutive secondary failures', () => {
    const nowMs = 1_700_000_000_000;
    const details = makeDetails({
      status: 429,
      message: 'Secondary rate limit exceeded',
      retry_after_seconds: null,
      rate_limit_remaining: 1,
      rate_limit_reset: null,
    });

    const event: RateLimitEvent = { kind: 'secondary', details };
    const priorState = { blocked_until_ms: null, secondary_consecutive: 1 };
    const decision = handleRateLimitError(priorState, event, nowMs);

    expect(decision.secondary_retry_count).toBe(2);
    expect(decision.wait_ms).toBe(120_000);
    expect(decision.next_allowed_at_ms).toBe(nowMs + 120_000);
  });

  it('waits until reset for primary rate-limit responses', () => {
    const nowMs = 1_700_000_000_000;
    const details = makeDetails({
      status: 403,
      message: 'API rate limit exceeded',
      rate_limit_remaining: 0,
      rate_limit_reset: Math.floor((nowMs + 120_000) / 1000),
    });

    const event: RateLimitEvent = { kind: 'primary', details };
    const decision = handleRateLimitError(createRateLimitControlState(), event, nowMs);

    expect(decision.wait_ms).toBe(120_000);
    expect(decision.next_allowed_at_ms).toBe(nowMs + 120_000);
  });
});

describe('applyRateLimitGate', () => {
  it('extends sleep and disables burst while blocked', () => {
    const nowMs = 1_700_000_000_000;
    const plan = { sleepMs: 5_000, burst: true, burstGapMs: 5_000 };
    const controlState = { blocked_until_ms: nowMs + 10_000, secondary_consecutive: 0 };

    const gated = applyRateLimitGate(plan, controlState, nowMs);

    expect(gated.sleepMs).toBe(10_000);
    expect(gated.burst).toBe(false);
    expect(gated.blocked).toBe(true);
  });
});
