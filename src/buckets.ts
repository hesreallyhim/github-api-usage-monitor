/**
 * Rate-limit bucket policy.
 *
 * GitHub deprecated resources.code_scanning_upload and will remove it from
 * /rate_limit on 2026-05-19. Until then, API responses may still include it,
 * but code scanning upload usage is documented as accounted under core, so the
 * deprecated alias is intentionally ignored preemptively.
 */

const IGNORED_RATE_LIMIT_BUCKETS = new Set(['code_scanning_upload']);

export function isIgnoredRateLimitBucket(name: string): boolean {
  return IGNORED_RATE_LIMIT_BUCKETS.has(name);
}
