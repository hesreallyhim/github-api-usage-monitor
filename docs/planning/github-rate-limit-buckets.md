# GitHub Rate-Limit Bucket Reference

> Created: 2026-01-29
> Purpose: Prerequisite research for self-test integration suite design.
> Source: GitHub REST API docs + real `/rate_limit` response from CI runner.

---

## 1. Bucket Inventory

14 buckets observed in real responses, grouped by window duration.

### Hour-buckets (60-minute primary windows)

| Bucket | Limit (GITHUB_TOKEN) | Limit (PAT) | Notes |
|--------|---------------------|-------------|-------|
| `core` | 1,000/hr | 5,000/hr | All REST endpoints not assigned to another bucket |
| `graphql` | 1,000 pts/hr | 5,000 pts/hr | Point-based; simple queries cost 1 pt |
| `integration_manifest` | 5,000/hr | 5,000/hr | `POST /app-manifests/{code}/conversions` only |
| `code_scanning_upload` | 5,000/hr | 5,000/hr | **Mirrors `core` exactly** (see caveat below) |
| `actions_runner_registration` | 10,000/hr | 10,000/hr | Self-hosted runner registration |
| `scim` | 15,000/hr | 15,000/hr | SCIM provisioning |
| `audit_log` | 1,750/hr | 1,750/hr | Enterprise audit log |
| `audit_log_streaming` | 15/hr | 15/hr | Audit log streaming config |

### Minute-buckets (60-second primary windows)

| Bucket | Limit (GITHUB_TOKEN) | Limit (PAT) | Notes |
|--------|---------------------|-------------|-------|
| `search` | 30/min | 30/min | `/search/*` except code search |
| `code_search` | 10/min | 10/min | `/search/code` only (separated Apr 2023) |
| `source_import` | 100/min | 100/min | Source import endpoints |
| `code_scanning_autofix` | 10/min | 10/min | Autofix suggestions |
| `dependency_snapshots` | 100/min | 100/min | Dependency graph submissions |
| `dependency_sbom` | 100/min | 100/min | SBOM requests |

---

## 2. Endpoint-to-Bucket Mapping (for test design)

| API Call | Bucket | Curl example |
|----------|--------|--------------|
| `GET /repos/{owner}/{repo}` | core | `curl -H "Authorization: Bearer $T" https://api.github.com/repos/O/R` |
| `GET /user` | core | `curl -H "Authorization: Bearer $T" https://api.github.com/user` |
| `GET /repos/{o}/{r}/issues` | core | similar |
| `GET /search/repositories?q=...` | search | `curl -H "Authorization: Bearer $T" "https://api.github.com/search/repositories?q=test"` |
| `GET /search/code?q=...` | code_search | `curl -H "Authorization: Bearer $T" "https://api.github.com/search/code?q=test+repo:o/r"` |
| `POST /graphql` | graphql | `curl -H "Authorization: Bearer $T" -d '{"query":"{ viewer { login } }"}' https://api.github.com/graphql` |
| `GET /rate_limit` | **none** | Does NOT consume any primary rate-limit quota |

---

## 3. Caveats and Undocumented Behaviors

### core / code_scanning_upload mirror

In practice, `code_scanning_upload` always shows identical `used`, `remaining`, and `reset` values to `core`. Their usage is NOT cumulative — do not sum them when computing total consumption. This is undocumented but consistently observed.

### Inactive buckets

A bucket with no calls within its window always reports `reset ≈ now + window_duration`. The bucket is simply inactive and the reset time reflects a hypothetical window start. Our reducer must treat this as a no-op (no window crossing).

### Rate limits are repo-wide

All jobs in a repository share the same `GITHUB_TOKEN` rate-limit pool. A test may start while hour-buckets are already active from prior jobs, meaning `core` may already have nonzero `used` and an anchored reset time.

### `/rate_limit` is free

Polling it does NOT consume primary rate limit. Only secondary rate limits apply (not queryable, not strictly deterministic — guidelines only, not relevant to our calculations).

### Deprecated `rate` object

The top-level `rate` field in the API response mirrors `core` and should be ignored.

### `x-ratelimit-resource` header

Each API response includes this header confirming which bucket was charged.

---

## 4. Implications for Self-Test Design

| Dimension | Determinism | Why |
|-----------|-------------|-----|
| **Used** (total_used delta) | Deterministic | We control how many API calls we make per bucket |
| **Windows crossed** | Semi-deterministic | For 60-sec buckets, depends on timing vs. window boundary. For 60-min buckets, a crossing is possible if the bucket was already active before the test |
| **Remaining** | Non-deterministic | Depends on whether other jobs or prior workflow runs consumed quota in the same window |

All calculations and reporting should strictly be based on rate-limit response headers. Secondary rate-limit data is not available or relevant.

---

## 5. Real Response Example (from CI runner)

Three distinct reset times observed, falling into three groups:

| Group | Reset epoch | Window | State | Buckets |
|-------|------------|--------|-------|---------|
| A | 1769287177 | 60 min | Inactive (used=0) | graphql, integration_manifest, actions_runner_registration, scim, audit_log, audit_log_streaming |
| B | 1769286000 | 60 min | Active (used=1098) | core, code_scanning_upload |
| C | 1769283637 | 60 sec | Inactive (used=0) | search, code_search, source_import, code_scanning_autofix, dependency_snapshots, dependency_sbom |

This shows the rough split: ~8 hour-buckets (6 inactive + 2 active/mirrored) and ~6 minute-buckets (all inactive at sample time).
