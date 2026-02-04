/**
 * Single Poll Orchestration
 *
 * Performs one poll cycle: fetch rate limit, reduce state, write state,
 * and optionally append diagnostics.
 * Extracted from poller.ts for testability.
 */
import type { ReducerState, RateLimitResponse, PollLogEntry } from '../types';
import type { ReduceResult } from '../reducer';
import type { RateLimitControlState } from './rate-limit-control';
export interface PerformPollSuccess {
    success: true;
    state: ReducerState;
    control_state: RateLimitControlState;
}
export interface PerformPollFailure {
    success: false;
    state: ReducerState;
    control_state: RateLimitControlState;
    error: string;
    fatal: boolean;
}
export type PerformPollOutcome = PerformPollSuccess | PerformPollFailure;
/**
 * Builds a diagnostics poll log entry from reduce results and raw API data.
 * Pure function — testable with zero mocks.
 */
export declare function buildDiagnosticsEntry(reduceResult: ReduceResult, rateLimitData: RateLimitResponse, pollNumber: number, timestamp: string): PollLogEntry;
/**
 * Performs a single poll and updates state.
 */
export declare function performPoll(state: ReducerState, token: string, diagnosticsEnabled: boolean, controlState: RateLimitControlState): Promise<PerformPollOutcome>;
