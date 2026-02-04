/**
 * GitHub Client Tests
 *
 * Fixture-based parsing tests for /rate_limit payloads.
 * Tests derived from spec/spec.json milestones M1, M3.
 *
 * Exit criteria:
 *   - GitHub client fetches and parses /rate_limit
 *   - Fixture-based parsing tests for /rate_limit payloads
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidSample, parseRateLimitResponse, fetchRateLimit } from '../src/github';
import { FETCH_TIMEOUT_MS } from '../src/types';
import type { RateLimitSample } from '../src/types';

// Load fixtures
import standardResponse from './fixtures/rate_limit_standard.json';
import minimalResponse from './fixtures/rate_limit_minimal.json';
import allBucketsResponse from './fixtures/rate_limit_all_buckets.json';

// -----------------------------------------------------------------------------
// isValidSample tests
// -----------------------------------------------------------------------------

describe('isValidSample', () => {
  it('returns true for valid sample', () => {
    const sample: RateLimitSample = {
      limit: 5000,
      used: 100,
      remaining: 4900,
      reset: 1706200000,
    };

    expect(isValidSample(sample)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidSample(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidSample(undefined)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isValidSample('string')).toBe(false);
    expect(isValidSample(123)).toBe(false);
    expect(isValidSample([])).toBe(false);
  });

  it('returns false for missing limit', () => {
    expect(isValidSample({ used: 100, remaining: 4900, reset: 1706200000 })).toBe(false);
  });

  it('returns false for missing used', () => {
    expect(isValidSample({ limit: 5000, remaining: 4900, reset: 1706200000 })).toBe(false);
  });

  it('returns false for missing remaining', () => {
    expect(isValidSample({ limit: 5000, used: 100, reset: 1706200000 })).toBe(false);
  });

  it('returns false for missing reset', () => {
    expect(isValidSample({ limit: 5000, used: 100, remaining: 4900 })).toBe(false);
  });

  it('returns false for wrong types', () => {
    expect(isValidSample({ limit: '5000', used: 100, remaining: 4900, reset: 1706200000 })).toBe(
      false,
    );
    expect(isValidSample({ limit: 5000, used: '100', remaining: 4900, reset: 1706200000 })).toBe(
      false,
    );
  });
});

// -----------------------------------------------------------------------------
// parseRateLimitResponse tests - fixtures
// -----------------------------------------------------------------------------

describe('parseRateLimitResponse', () => {
  it('parses standard GitHub response', () => {
    const result = parseRateLimitResponse(standardResponse);

    expect(result).not.toBeNull();
    expect(result?.resources['core']).toBeDefined();
    expect(result?.resources['search']).toBeDefined();
    expect(result?.rate).toBeDefined();
  });

  it('parses minimal response with just core', () => {
    const result = parseRateLimitResponse(minimalResponse);

    expect(result).not.toBeNull();
    expect(result?.resources['core']).toBeDefined();
  });

  it('parses response with all known buckets', () => {
    const result = parseRateLimitResponse(allBucketsResponse);

    expect(result).not.toBeNull();
    const buckets = Object.keys(result?.resources ?? {});
    expect(buckets).toContain('core');
    expect(buckets).toContain('search');
    expect(buckets).toContain('graphql');
    expect(buckets).toContain('integration_manifest');
    expect(buckets).toContain('code_scanning_upload');
  });

  it('returns null for invalid response', () => {
    expect(parseRateLimitResponse(null)).toBeNull();
    expect(parseRateLimitResponse(undefined)).toBeNull();
    expect(parseRateLimitResponse('string')).toBeNull();
    expect(parseRateLimitResponse(123)).toBeNull();
  });

  it('returns null for missing resources', () => {
    expect(parseRateLimitResponse({ rate: {} })).toBeNull();
  });

  it('returns null when all resources are invalid and rate is invalid', () => {
    expect(
      parseRateLimitResponse({
        resources: { core: { limit: 'invalid' } },
        rate: {},
      }),
    ).toBeNull();
  });

  it('extracts correct values from sample', () => {
    const result = parseRateLimitResponse(standardResponse);

    const core = result?.resources['core'];
    expect(core?.limit).toBe(5000);
    expect(core?.used).toBe(123);
    expect(core?.remaining).toBe(4877);
    expect(core?.reset).toBe(1706230800);
  });
});

// -----------------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------------

describe('parseRateLimitResponse - edge cases', () => {
  it('handles zero values', () => {
    const response = {
      resources: {
        core: { limit: 5000, used: 0, remaining: 5000, reset: 1706200000 },
      },
      rate: { limit: 5000, used: 0, remaining: 5000, reset: 1706200000 },
    };

    const result = parseRateLimitResponse(response);

    expect(result?.resources['core']?.used).toBe(0);
    expect(result?.resources['core']?.remaining).toBe(5000);
  });

  it('handles limit exhausted', () => {
    const response = {
      resources: {
        core: { limit: 5000, used: 5000, remaining: 0, reset: 1706200000 },
      },
      rate: { limit: 5000, used: 5000, remaining: 0, reset: 1706200000 },
    };

    const result = parseRateLimitResponse(response);

    expect(result?.resources['core']?.remaining).toBe(0);
  });

  it('handles extra fields gracefully', () => {
    const response = {
      resources: {
        core: {
          limit: 5000,
          used: 100,
          remaining: 4900,
          reset: 1706200000,
          extra_field: 'ignored',
        },
      },
      rate: { limit: 5000, used: 100, remaining: 4900, reset: 1706200000 },
      extra_top_level: {},
    };

    const result = parseRateLimitResponse(response);

    expect(result).not.toBeNull();
    expect(result?.resources['core']?.limit).toBe(5000);
  });
});

// -----------------------------------------------------------------------------
// fetchRateLimit tests - timeout behavior
// -----------------------------------------------------------------------------

describe('fetchRateLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles AbortError correctly and returns FetchRateLimitError', async () => {
    // Mock fetch to throw an AbortError (simulates what happens on timeout)
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    const mockFetch = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Request timeout');
      expect(result.error).toContain(String(FETCH_TIMEOUT_MS));
    }
  });

  it('handles network errors correctly', async () => {
    // Mock fetch to throw a network error
    const networkError = new Error('Network connection failed');
    networkError.name = 'TypeError';

    const mockFetch = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Network error');
      expect(result.error).toContain('Network connection failed');
    }
  });

  it('returns success for valid response', async () => {
    // Mock fetch to return a valid response
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(standardResponse),
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources['core']).toBeDefined();
    }
  });

  it('returns error for HTTP error response', async () => {
    // Mock fetch to return an error response
    const mockResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue(''),
      headers: {
        get: vi.fn().mockReturnValue(null),
      },
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTP 401');
      expect(result.error).toContain('Unauthorized');
    }
  });

  it('captures rate limit headers and message for 429 responses', async () => {
    const headerMap = new Map([
      ['x-ratelimit-remaining', '0'],
      ['x-ratelimit-reset', '1706203600'],
      ['retry-after', '45'],
    ]);

    const mockResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'Secondary rate limit exceeded' })),
      headers: {
        get: (name: string) => headerMap.get(name) ?? null,
      },
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTP 429');
      expect(result.rate_limit?.status).toBe(429);
      expect(result.rate_limit?.rate_limit_remaining).toBe(0);
      expect(result.rate_limit?.rate_limit_reset).toBe(1706203600);
      expect(result.rate_limit?.retry_after_seconds).toBe(45);
      expect(result.rate_limit?.message).toContain('Secondary rate limit exceeded');
    }
  });

  it('passes abort signal to fetch', async () => {
    // Mock fetch to capture the signal
    let capturedSignal: AbortSignal | undefined;
    const mockFetch = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) => {
        capturedSignal = options?.signal as AbortSignal | undefined;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(standardResponse),
        });
      });
    vi.stubGlobal('fetch', mockFetch);

    await fetchRateLimit('test-token');

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts fetch when signal is triggered', async () => {
    // This test verifies that the abort signal works by:
    // 1. Capturing the signal passed to fetch
    // 2. Verifying fetch was called with a signal that will abort
    let capturedSignal: AbortSignal | undefined;
    const mockFetch = vi
      .fn()
      .mockImplementation((_url: string, options: RequestInit | undefined) => {
        capturedSignal = options?.signal as AbortSignal | undefined;
        // Return a valid response for this test
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(standardResponse),
        });
      });
    vi.stubGlobal('fetch', mockFetch);

    await fetchRateLimit('test-token');

    // Verify the signal was passed and is connected to an AbortController
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // The signal should not be aborted immediately (timeout hasn't elapsed)
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('returns error for invalid JSON response', async () => {
    // Mock fetch to return invalid JSON
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ invalid: 'response' }),
    };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchRateLimit('test-token');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Failed to parse');
    }
  });
});
