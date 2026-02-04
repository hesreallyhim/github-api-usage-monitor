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
import type { PollLogEntry, RateLimitErrorKind } from '../types';
import type { SleepPlan } from './sleep-plan';
export declare const MAX_SECONDARY_RETRIES = 5;
export declare const SECONDARY_DEFAULT_WAIT_MS = 60000;
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
export declare function createRateLimitControlState(): RateLimitControlState;
export declare function resetRateLimitControl(state: RateLimitControlState): RateLimitControlState;
export declare function classifyRateLimitError(details: RateLimitErrorDetails): RateLimitErrorKind | null;
export declare function handleRateLimitError(state: RateLimitControlState, event: RateLimitEvent, nowMs: number): RateLimitDecision;
export declare function applyRateLimitGate(plan: SleepPlan, controlState: RateLimitControlState, nowMs: number): RateLimitGateResult;
export declare function buildRateLimitErrorEntry(event: RateLimitEvent, pollNumber: number, timestamp: string, decision: RateLimitDecision): PollLogEntry;
