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

/**
 * Builds a diagnostics poll log entry from reduce results and raw API data.
 * Pure function — testable with zero mocks.
 */
export function buildDiagnosticsEntry(
  reduceResult: ReduceResult,
  rateLimitData: RateLimitResponse,
  pollCount: number,
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
    poll_number: pollCount,
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
): Promise<ReducerState> {
  const timestamp = new Date().toISOString();
  const result = await fetchRateLimit(token);

  if (!result.success) {
    const newState = recordFailure(state, result.error);
    writeState(newState);
    return newState;
  }

  const reduceResult: ReduceResult = reduce(state, result.data, timestamp);
  const newState = reduceResult.state;
  writeState(newState);

  if (diagnosticsEnabled) {
    const logEntry = buildDiagnosticsEntry(
      reduceResult,
      result.data,
      newState.poll_count,
      timestamp,
    );
    appendPollLogEntry(logEntry);
  }

  return newState;
}
