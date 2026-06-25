# Rate Limit Buckets

The table below represents the 60-minute reset window buckets. The limits are the primary rate limits for authenticated users and PATs - GitHub App installation tokens and Enterprise users may have different limits. Additionally `GITHUB_TOKEN` has a primary rate limit of 1,000 requests per repository per hour.[^1]

GitHub scheduled the removal of the deprecated `code_scanning_upload` field from the `/rate_limit` API response for May 19, 2026. If a stale response still includes that field, this action does not track or report it because GitHub documents code scanning uploads as counted under `core`.[^2]

GitHub's `/rate_limit` schema also now documents a `copilot_usage_records` bucket. The monitored GitHub Docs pages do not currently describe its reset window, so it is not classified in the tables below; this action will still report it automatically if GitHub returns it.

| Bucket | Limit per window |
| --- | --- |
| core | 5000 |
| graphql | 5000 |
| integration_manifest | 5000 |
| actions_runner_registration | 10000 |
| scim | 15000 |
| audit_log | 1750 |
| audit_log_streaming | 15 |

The table below represents the 60-second reset window buckets.

| Bucket | Limit per window |
| --- | --- |
| search | 30 |
| code_search | 10 |
| source_import | 100 |
| code_scanning_autofix | 10 |
| dependency_snapshots | 100 |
| dependency_sbom | 100 |

[^1] Data is based on current documentation, and is not guaranteed to be stable even within a given API version.
[^2] GitHub changelog: [Deprecation notice: `code_scanning_upload` field will be removed from Rate Limit API endpoint](https://github.blog/changelog/2026-05-05-deprecation-notice-code_scanning_upload-field-will-be-removed-from-rate_limit-api-endpoint/).
