/**
 * Rate-limit bucket policy.
 *
 * GitHub documents code scanning uploads as accounted under the core bucket.
 * If the deprecated resources.code_scanning_upload alias still appears in
 * /rate_limit responses or examples, ignore it so usage is not double-counted.
 */

const IGNORED_RATE_LIMIT_BUCKETS = new Set(['code_scanning_upload']);

export function isIgnoredRateLimitBucket(name: string): boolean {
  return IGNORED_RATE_LIMIT_BUCKETS.has(name);
}
