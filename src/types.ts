/**
 * Boundary types for github-api-usage-monitor v1
 * Generated from spec/spec.json
 *
 * These types define the contracts between modules.
 * Do not modify without updating the spec.
 */

// -----------------------------------------------------------------------------
// RateLimitSample
// Single sample from /rate_limit for one bucket
// -----------------------------------------------------------------------------

export interface RateLimitSample {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Requests used in the current window */
  used: number;
  /** Requests remaining in the current window */
  remaining: number;
  /** Unix epoch seconds when the window resets */
  reset: number;
}

// -----------------------------------------------------------------------------
// RateLimitResponse
// Full response from GET /rate_limit
// -----------------------------------------------------------------------------

export interface RateLimitResponse {
  /** Rate limit data per bucket (core, search, graphql, etc.) */
  resources: Record<string, RateLimitSample>;
  /** Deprecated alias for resources.core */
  rate: RateLimitSample;
}

// -----------------------------------------------------------------------------
// BucketState
// Per-bucket reducer state
// -----------------------------------------------------------------------------

export interface BucketState {
  /** Unix epoch seconds of the last seen reset timestamp */
  last_reset: number;
  /** Last observed 'used' value */
  last_used: number;
  /** Accumulated usage across the job duration */
  total_used: number;
  /** Number of times the reset boundary was crossed */
  windows_crossed: number;
  /** Count of unexpected deltas (used decreased without reset change) */
  anomalies: number;
  /** ISO timestamp of last observation (for debugging) */
  last_seen_ts: string;
  /** Last observed limit */
  limit: number;
  /** Last observed remaining */
  remaining: number;
  /** First observed 'used' value (baseline, set on init) */
  first_used: number;
  /** First observed 'remaining' value (baseline, set on init) */
  first_remaining: number;
}

// -----------------------------------------------------------------------------
// ReducerState
// Global reducer state persisted to state.json
// -----------------------------------------------------------------------------

export interface ReducerState {
  /** Per-bucket state keyed by bucket name */
  buckets: Record<string, BucketState>;
  /** ISO timestamp when monitoring started */
  started_at_ts: string;
  /** ISO timestamp when monitoring stopped (null if still running) */
  stopped_at_ts: string | null;
  /** ISO timestamp when poller process started (null before poller runs) */
  poller_started_at_ts: string | null;
  /** Polling interval in seconds */
  interval_seconds: number;
  /** Total number of successful polls */
  poll_count: number;
  /** Total number of failed poll attempts */
  poll_failures: number;
  /** Total number of secondary rate-limit responses observed */
  secondary_rate_limit_hits: number;
  /** Last error message (null if no errors) */
  last_error: string | null;
}

// -----------------------------------------------------------------------------
// SummaryData
// Data passed to output renderer for summary generation
// -----------------------------------------------------------------------------

export interface SummaryData {
  /** Final reducer state */
  state: ReducerState;
  /** Job duration in seconds */
  duration_seconds: number;
  /** Warning messages to display */
  warnings: string[];
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export interface Config {
  /** GitHub token for API authentication */
  token: string;
  /** Polling interval in seconds */
  interval_seconds: number;
}

// -----------------------------------------------------------------------------
// Platform info
// -----------------------------------------------------------------------------

export type Platform = 'linux' | 'darwin' | 'win32' | 'unknown';

export interface PlatformInfo {
  platform: Platform;
  supported: boolean;
  reason?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const POLL_INTERVAL_SECONDS = 30;
export const STATE_DIR_NAME = 'github-api-usage-monitor';
export const STATE_FILE_NAME = 'state.json';
export const PID_FILE_NAME = 'poller.pid';

export const POLL_LOG_FILE_NAME = 'poll-log.jsonl';

// -----------------------------------------------------------------------------
// PollLogEntry
// Diagnostic per-poll snapshot for the JSONL poll log
// -----------------------------------------------------------------------------

export interface PollLogBucketSnapshot {
  /** Observed 'used' value */
  used: number;
  /** Observed 'remaining' value */
  remaining: number;
  /** Reset epoch seconds */
  reset: number;
  /** Rate limit ceiling */
  limit: number;
  /** Delta applied this poll */
  delta: number;
  /** True if a window boundary was crossed */
  window_crossed: boolean;
  /** True if an anomaly was detected */
  anomaly: boolean;
}

export interface PollLogEntry {
  /** ISO timestamp of this poll */
  timestamp: string;
  /** Sequential poll number (1-based) */
  poll_number: number;
  /** Per-bucket snapshot */
  buckets: Record<string, PollLogBucketSnapshot>;
  /** Optional error context for rate-limit responses */
  error?: PollLogError;
}

/** Timeout for fetch requests to GitHub API (milliseconds) */
export const FETCH_TIMEOUT_MS = 10000;

/** Maximum poller lifetime as defense-in-depth (6 hours in milliseconds) */
export const MAX_LIFETIME_MS = 6 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Rate limit error diagnostics (poll log + warnings)
// -----------------------------------------------------------------------------

export type RateLimitErrorKind = 'primary' | 'secondary' | 'unknown';

export interface PollLogError {
  /** Rate limit classification */
  kind: RateLimitErrorKind;
  /** HTTP status code */
  status: number;
  /** Error message from API response (if available) */
  message: string | null;
  /** Retry-After header value (seconds) */
  retry_after_seconds: number | null;
  /** X-RateLimit-Remaining header value */
  rate_limit_remaining: number | null;
  /** X-RateLimit-Reset header value (epoch seconds) */
  rate_limit_reset: number | null;
  /** Next allowed request time (epoch seconds) */
  next_allowed_at: number | null;
  /** Consecutive secondary-limit retries (0 for non-secondary) */
  secondary_retry_count: number;
}
