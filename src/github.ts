/**
 * GitHub API Client
 * Layer: infra
 *
 * Provided ports:
 *   - github.fetchRateLimit
 *
 * Fetches rate limit data from the GitHub API.
 */

import type { RateLimitResponse, RateLimitSample } from './types';

// -----------------------------------------------------------------------------
// Port: github.fetchRateLimit
// -----------------------------------------------------------------------------

export interface FetchRateLimitResult {
  success: true;
  data: RateLimitResponse;
  timestamp: string;
}

export interface FetchRateLimitError {
  success: false;
  error: string;
  timestamp: string;
}

export type FetchRateLimitOutcome = FetchRateLimitResult | FetchRateLimitError;

/**
 * Fetches rate limit data from GitHub API.
 *
 * @param token - GitHub token for authentication
 * @returns Rate limit response or error
 */
export async function fetchRateLimit(token: string): Promise<FetchRateLimitOutcome> {
  const timestamp = new Date().toISOString();

  // TODO: Implement
  // - Make GET request to https://api.github.com/rate_limit
  // - Set Authorization header with token
  // - Parse response as RateLimitResponse
  // - Handle errors gracefully (network, auth, parse)
  throw new Error('Not implemented: github.fetchRateLimit');
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Validates that a sample has the expected shape.
 * Used for defensive parsing.
 */
export function isValidSample(sample: unknown): sample is RateLimitSample {
  if (typeof sample !== 'object' || sample === null) {
    return false;
  }
  const s = sample as Record<string, unknown>;
  return (
    typeof s['limit'] === 'number' &&
    typeof s['used'] === 'number' &&
    typeof s['remaining'] === 'number' &&
    typeof s['reset'] === 'number'
  );
}

/**
 * Parses raw API response into typed RateLimitResponse.
 * Returns null if parsing fails.
 */
export function parseRateLimitResponse(raw: unknown): RateLimitResponse | null {
  // TODO: Implement
  // - Validate resources is an object
  // - Validate each resource is a valid sample
  // - Validate rate is a valid sample
  throw new Error('Not implemented: parseRateLimitResponse');
}
