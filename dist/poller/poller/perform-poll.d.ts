/**
 * Single Poll Orchestration
 *
 * Performs one poll cycle: fetch rate limit, reduce state, write state,
 * and optionally append diagnostics.
 * Extracted from poller.ts for testability.
 */
import type { ReducerState, RateLimitResponse, PollLogEntry } from '../types';
import type { ReduceResult } from '../reducer';
/**
 * Builds a diagnostics poll log entry from reduce results and raw API data.
 * Pure function — testable with zero mocks.
 */
export declare function buildDiagnosticsEntry(reduceResult: ReduceResult, rateLimitData: RateLimitResponse, pollCount: number, timestamp: string): PollLogEntry;
/**
 * Performs a single poll and updates state.
 */
export declare function performPoll(state: ReducerState, token: string, diagnosticsEnabled: boolean): Promise<ReducerState>;
