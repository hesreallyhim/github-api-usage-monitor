/**
 * Rate-limit bucket policy.
 *
 * GitHub documents code scanning uploads as accounted under the core bucket.
 * If the deprecated resources.code_scanning_upload alias still appears in
 * /rate_limit responses or examples, ignore it so usage is not double-counted.
 */
export declare function isIgnoredRateLimitBucket(name: string): boolean;
