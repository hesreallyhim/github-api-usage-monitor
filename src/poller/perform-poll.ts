/**
 * Single Poll Orchestration
 *
 * Performs one poll cycle: fetch rate limit, reduce state, write state,
 * and optionally append diagnostics.
 * Extracted from poller.ts for testability.
 */

import type {
  ReducerState,
  RateLimitResponse,
  PollLogEntry,
  PollLogBucketSnapshot,
} from '../types';
import { fetchRateLimit } from '../github';
import { reduce, recordFailure } from '../reducer';
import type { ReduceResult } from '../reducer';
import { writeState } from '../state';
import { appendPollLogEntry } from '../poll-log';
import type {
  RateLimitControlState,
  RateLimitEvent,
  RateLimitDecision,
} from './rate-limit-control';
import {
  buildRateLimitErrorEntry,
  classifyRateLimitError,
  handleRateLimitError,
  resetRateLimitControl,
} from './rate-limit-control';

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
export function buildDiagnosticsEntry(
  reduceResult: ReduceResult,
  rateLimitData: RateLimitResponse,
  pollNumber: number,
  timestamp: string,
): PollLogEntry {
  const bucketSnapshots: Record<string, PollLogBucketSnapshot> = {};
  for (const [name, update] of Object.entries(reduceResult.updates)) {
    const sample = rateLimitData.resources[name];
    if (sample) {
      bucketSnapshots[name] = {
        used: sample.used,
        remaining: sample.remaining,
        reset: sample.reset,
        limit: sample.limit,
        delta: update.delta,
        window_crossed: update.window_crossed,
        anomaly: update.anomaly,
      };
    }
  }
  return {
    timestamp,
    poll_number: pollNumber,
    buckets: bucketSnapshots,
  };
}

/**
 * Performs a single poll and updates state.
 */
export async function performPoll(
  state: ReducerState,
  token: string,
  diagnosticsEnabled: boolean,
  controlState: RateLimitControlState,
): Promise<PerformPollOutcome> {
  const timestamp = new Date().toISOString();
  let nextControlState = controlState;
  const result = await fetchRateLimit(token);

  if (!result.success) {
    const rateLimitDetails = result.rate_limit;
    const rateLimitKind = rateLimitDetails ? classifyRateLimitError(rateLimitDetails) : null;
    const rateLimitEvent: RateLimitEvent | null =
      rateLimitKind && rateLimitDetails ? { kind: rateLimitKind, details: rateLimitDetails } : null;

    let rateLimitDecision: RateLimitDecision | null = null;
    if (rateLimitEvent) {
      rateLimitDecision = handleRateLimitError(controlState, rateLimitEvent, Date.now());
      nextControlState = rateLimitDecision.state;
    }

    const newState = recordFailure(state, result.error, {
      rate_limit_kind: rateLimitEvent?.kind,
    });
    writeState(newState);

    if (diagnosticsEnabled && rateLimitEvent && rateLimitDecision) {
      const pollNumber = newState.poll_count + newState.poll_failures;
      const logEntry = buildRateLimitErrorEntry(
        rateLimitEvent,
        pollNumber,
        timestamp,
        rateLimitDecision,
      );
      appendPollLogEntry(logEntry);
    }

    return {
      success: false,
      state: newState,
      control_state: nextControlState,
      error: result.error,
      fatal: rateLimitDecision?.fatal ?? false,
    };
  }

  const reduceResult: ReduceResult = reduce(state, result.data, timestamp);
  const newState = reduceResult.state;
  writeState(newState);
  nextControlState = resetRateLimitControl(controlState);

  if (diagnosticsEnabled) {
    const pollNumber = newState.poll_count + newState.poll_failures;
    const logEntry = buildDiagnosticsEntry(reduceResult, result.data, pollNumber, timestamp);
    appendPollLogEntry(logEntry);
  }

  return {
    success: true,
    state: newState,
    control_state: nextControlState,
  };
}
