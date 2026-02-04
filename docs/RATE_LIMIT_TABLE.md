# Rate Limit Buckets

The table below represents the 60-minute reset window buckets. The limits are the primary rate limits for authenticated users and PATs - GitHub App installation tokens and Enterprise users may have different limits. Additionally `GITHUB_TOKEN` has a primary rate limit of 1,000 requests per repository per hour.[^1]

| Bucket | Limit per window |
| --- | --- |
| core | 5000 |
| graphql | 5000 |
| integration_manifest | 5000 |
| code_scanning_upload | 5000 |
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
