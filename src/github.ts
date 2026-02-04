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

export interface RateLimitErrorDetails {
  status: number;
  message: string | null;
  rate_limit_remaining: number | null;
  rate_limit_reset: number | null;
  retry_after_seconds: number | null;
}

export interface FetchRateLimitError {
  success: false;
  error: string;
  timestamp: string;
  rate_limit?: RateLimitErrorDetails;
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
      const message = await readErrorMessage(response);
      const statusText = response.statusText || 'Unknown error';
      const error = message
        ? `HTTP ${response.status}: ${statusText} - ${message}`
        : `HTTP ${response.status}: ${statusText}`;
      return {
        success: false,
        error,
        timestamp,
        rate_limit: buildRateLimitErrorDetails(response, message),
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

function parseHeaderNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const text = (await response.text()).trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (parsed && typeof parsed.message === 'string') {
        return parsed.message;
      }
    } catch {
      // Fall back to raw text
    }
    return text;
  } catch {
    return null;
  }
}

function buildRateLimitErrorDetails(
  response: Response,
  message: string | null,
): RateLimitErrorDetails {
  return {
    status: response.status,
    message,
    rate_limit_remaining: parseHeaderNumber(response.headers, 'x-ratelimit-remaining'),
    rate_limit_reset: parseHeaderNumber(response.headers, 'x-ratelimit-reset'),
    retry_after_seconds: parseHeaderNumber(response.headers, 'retry-after'),
  };
}

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
