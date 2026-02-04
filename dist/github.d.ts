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
export declare function fetchRateLimit(token: string): Promise<FetchRateLimitOutcome>;
/**
 * Validates that a sample has the expected shape.
 * Used for defensive parsing.
 */
export declare function isValidSample(sample: unknown): sample is RateLimitSample;
/**
 * Parses raw API response into typed RateLimitResponse.
 * Returns null if parsing fails.
 */
export declare function parseRateLimitResponse(raw: unknown): RateLimitResponse | null;
