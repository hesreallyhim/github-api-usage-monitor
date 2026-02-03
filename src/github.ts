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
import { FETCH_TIMEOUT_MS } from './types';
import { isARealObject } from './utils';
// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const RATE_LIMIT_URL = 'https://api.github.com/rate_limit';
const USER_AGENT = 'github-api-usage-monitor';

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

  // Set up abort controller with timeout to prevent indefinite hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(RATE_LIMIT_URL, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const statusText = response.statusText || 'Unknown error';
      return {
        success: false,
        error: `HTTP ${response.status}: ${statusText}`,
        timestamp,
      };
    }

    const raw: unknown = await response.json();
    const parsed = parseRateLimitResponse(raw);

    if (!parsed) {
      return {
        success: false,
        error: 'Failed to parse rate limit response',
        timestamp,
      };
    }

    return {
      success: true,
      data: parsed,
      timestamp,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    const error = err as Error;

    // Handle abort error specifically (timeout)
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: `Request timeout: GitHub API did not respond within ${FETCH_TIMEOUT_MS}ms`,
        timestamp,
      };
    }

    return {
      success: false,
      error: `Network error: ${error.message}`,
      timestamp,
    };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Validates that a sample has the expected shape.
 * Used for defensive parsing.
 */
export function isValidSample(sample: unknown): sample is RateLimitSample {
  if (!isARealObject(sample)) {
    return false;
  }
  const requiredFields = ['limit', 'used', 'remaining', 'reset'];
  return requiredFields.every((field) => typeof sample[field] === 'number');
}

/**
 * Parses raw API response into typed RateLimitResponse.
 * Returns null if parsing fails.
 */
export function parseRateLimitResponse(raw: unknown): RateLimitResponse | null {
  if (!isARealObject(raw) || !isARealObject(raw['resources'])) {
    return null;
  }

  const resources: Record<string, RateLimitSample> = {};

  for (const [key, value] of Object.entries(raw['resources'])) {
    if (!isValidSample(value)) {
      continue; // Skip invalid resources instead of failing the entire response
    }
    resources[key] = value;
  }

  // Use rate if valid, otherwise fall back to resources.core
  const rawRate = raw['rate'];
  if (isValidSample(rawRate)) {
    return { resources, rate: rawRate };
  }

  const coreResource = resources['core'];
  if (coreResource) {
    return { resources, rate: coreResource };
  }

  return null;
}
