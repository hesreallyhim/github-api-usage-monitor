![Banner](./docs/assets/banner.svg)

# github-api-usage-monitor

A GitHub Action that monitors GitHub API usage during a workflow job. It safely polls `/rate_limit` in a background process throughout the job, then renders a per-bucket usage summary in the step summary.

GitHub Actions workflows may query the GitHub API and consume rate limits, but there's no built-in way to see how much. This action runs a lightweight background poller for the duration of your job and reports exactly which buckets were used, how much, and how close you are to the ceiling. Very helpful for anyone who is running workflows that interact with the GitHub API and want to monitor/analyze usage. It can track usage for any token that you pass in, including the default `GITHUB_TOKEN`.

## Quick Start

```yaml
- uses: hesreallyhim/github-api-usage-monitor@v1
```

That's it. Insert that anywhere in your workflow job. The action uses the pre/post hook lifecycle — it starts monitoring automatically before your first step and reports after your last step. No `start`/`stop` steps needed.

## How It Works

1. **Pre hook** — spawns a detached background process that polls `GET /rate_limit` with adaptive scheduling to ensure the highest accuracy possible.
2. **Main** — no-op - in order to work, the action has to be used somewhere in your job, but because it leverages pre/post job hooks, the "main" script does nothing.
3. **Post hook** — kills the poller and cleans up, performs a final poll, and writes a summary on your workflow tab. You may also upload fine-grained usage data as an artifact.

By default (`diagnostics` usage artifact not enabled), the monitor uses constant-space aggregation — it tracks per-bucket deltas across reset windows without storing historical samples, giving you an "overall" view of your workflow's API usage. If `diagnostics` is enabled, the action will preserve poll-by-poll snapshots to a JSONL log and upload them as artifacts, enabling more fine-grained analysis of API usage throughout the lifecycle of your job.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | No | `${{ github.token }}`<br>A.K.A. `GITHUB_TOKEN` | GitHub token for API authentication |
| `diagnostics` | No | `false` | Enable diagnostics logging and artifact upload of `state.json` (the overall usage summary) + `poll-log.json` - per-poll snapshots. |
| `artifact_name` | No | `github-api-usage-monitor-${GITHUB_JOB}` | Override diagnostics artifact name (used only when diagnostics is enabled) |

## Diagnostics artifacts

When `diagnostics` is enabled, the post hook uploads a per-job diagnostics artifact (defaults to `github-api-usage-monitor-${GITHUB_JOB}`) that contains:

- `state.json` — finalized summary state
- `poll-log.json` — poll log entries as a JSON array

Tip: when `diagnostics` is enabled in matrix jobs, you must ensure that each job's artifact has a unique name - for example, you may pass the `matrix.id` into the `artifact_name` input to avoid collisions (e.g., `github-api-usage-monitor-${{ matrix.id }}`).

### Using artifacts in downstream jobs

Because the collected data is generated in a post-job hook, it is _not_ available for consumption within the same job that is being observed. However, with `diagnostics` enabled, the data will automatically be uploaded as an artifact that can be downloaded and consumed in other jobs.

```yaml
jobs:
  usage-tracker:
    runs-on: ubuntu-latest
    steps:
      - uses: hesreallyhim/github-api-usage-monitor@v1
        with:
          diagnostics: true
      # ... The rest of your workflow - calls to GitHub API

  diagnostics:
    runs-on: ubuntu-latest
    needs: usage-tracker
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: download-usage-data-artifact
          path: ./monitor-artifacts

      - name: Check usage
        run: |
          jq '.buckets.core.total_used' ./monitor-artifacts/state.json
```

## Example Summary Output

The action writes a markdown table to the GitHub step summary:

> **Duration:** 5m 32s | **Polls:** 12 | **Failures:** 0
>
> | Bucket | Used (this job) | Remaining | Limit | Windows Crossed |
> |--------|---------------:|----------:|------:|:-:|
> | core | 47 | 4,953 | 5,000 | 0 |
> | graphql | 12 | 4,988 | 5,000 | 0 |
> | search | 3 | 30 | 30 | 1 |

For more information about "Windows Crossed", see [**Reset Windows**](#reset-windows) below.

## Supported Platforms

- Linux (GitHub-hosted runners)
- macOS (GitHub-hosted runners)

Windows is not supported (the action will fail fast with a clear error).

## Limitations

- **`GITHUB_TOKEN` limits** - the `/rate_limit` endpoint returns data that reflects the per-bucket limits for authenticated users (e.g. 5,000 requests per hour for `core`). However, the [documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#primary-rate-limit-for-github_token-in-github-actions) states that `GITHUB_TOKEN`, the token that is automatically generated for consumption by GitHub Actions, has a general rate limit of 1,000 requests per repository per hour (or 15,000 requests for GHEC). We have chosen to report the rate limit data that is returned from the `/rate_limit` API "transparently" - that is, we do not attempt to modify reports to accommodate the special limitations of `GITHUB_TOKEN`.
- **Shared rate-limit pool** — rate limits are shared amongst all jobs in a repository that use the same token. If concurrent workflows run, usage from other jobs (that use the same token) will appear in the report.
- **Polling resolution** — the poller is configured to run every 30 seconds by default, but this allows the possibility of a gap between the last poll and reset time for 60-second buckets such as `search`. In order to account for this, we have designed an _adaptive_ poller that targets polls near bucket resets and runs a few extra times; nevertheless, there's still an inherent ~3-5s uncertainty window which is unavoidable given the current design. Usage between the last poll and a reset boundary may be missed.
- **Bucket mirroring irregularity** - we have regularly observed a pattern in which the `core` bucket usage, as reported by the `/rate_limit` endpoint, and the `code_scanning_upload` bucket, report the same data. This is undocumented behavior, but does not appear to affect overall rate limits, in the sense that 5 `core` requests may appear to consume 5 `code_scanning_upload` requests, but we have no evidence that this results in a 10-request total usage consumption.
- **Querying the `/rate_limit` endpoint** - The action measures API usage by querying the `rate_limit` endpoint. A natural concern is - doesn't this impact the measurement itself? Fortunately, querying the `rate_limit` [endpoint](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#checking-the-status-of-your-rate-limit) does _not_ affect the primary rate limit for a given token. Therefore it is harmless from that perspective. Nevertheless, overly aggressive polling or abuse of that endpoint _can_ result in a violation of GitHub's _secondary_ rate limit.
- The secondary rate limit is broad in scope, and is meant to deter and penalize activity that is harmful to GitHub's servers. However, no clear statement of the secondary rate limit policy is available, and, by design, there is no way to query anything about the secondary rate limit. Given our experience, and what is documented, one request every 30 seconds (give or take) is within the realm of acceptability and non-abusive polling - however, it is important to keep this in mind when interacting with the GitHub API.
- This action's poller implements controls that are designed to avoid any secondary rate violations, however we _cannot_ provide any strong guarantee that this action will _definitely not_ trigger any secondary rate limit violations, due to the fact that this limit is, by nature, not entirely explicit. Furthermore, we do not accept any responsibility for secondary rate limit abuse that users may incur while using this action. You may review the source code in [`src/poller/rate-limit-control.ts`](./src/poller/rate-limit-control.ts) to confirm that we have built-in strict protections against rate limit abuse that correspond to every single line in the [documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#exceeding-the-rate-limit) regarding rate limit errors and how to respond to them.

## Reset Windows
- **Windows crossed** — the number of times a bucket reset occurred while the monitor was running.
- GitHub's primary rate limits appear to use fixed windows with reset times anchored to the first observed usage of the token (per resource bucket), rather than a rolling window. For `core`, e.g., this is 60 minutes from the first usage within an action. For other buckets, such as `search` the reset window is 60 seconds from the time of first use. (See [this document](./docs/RATE_LIMIT_TABLE.md) for a bucket-by-bucket breakdown.)
- What happens after this reset window is crossed is that the "Amount Remaining" data is reset to the maximum for that bucket, and the "Reset Time" is also reset to the full reset-window duration from the time of polling. This is a major design constraint on an action such as the current one, because a polling-based measurement must be designed such that the gap between the last poll and the next reset time is minimized - any activity that happens after a given poll, and before the next reset, will be invisible to the poller. That is the justification for the strategy of 30-second polling, with some "extra polls" at the designated reset time - this allows for high-confidence tracking of API requests to buckets with 60-second reset windows. 


## Disclaimer

The statements made in this document, and the implementation decisions in the code, are made in strict adherence to the GitHub API and Actions documentation at the time of writing. In addition, our CI processes regularly check for updates to the core documents. Best efforts have been made for strict compliance with GitHub's policy recommendations and guidelines - however, we accept no responsibility for any penalties incurred by the use of this action.

## License

MIT 2026 &copy; Really Him
