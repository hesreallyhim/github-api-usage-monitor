# github-api-usage-monitor

A GitHub Action that monitors API rate-limit usage during a CI job. It polls `/rate_limit` in a background process throughout the job, then renders a per-bucket usage summary in the step summary.

## Why

GitHub Actions workflows consume API rate limits, but there's no built-in way to see how much. This action runs a lightweight background poller for the duration of your job and reports exactly which buckets were used, how much, and how close you are to the ceiling.

## Quick Start

```yaml
- uses: hesreallyhim/github-api-usage-monitor@main
```

That's it. The action uses the pre/post hook lifecycle — it starts monitoring automatically before your first step and reports after your last step. No `start`/`stop` steps needed.

## How It Works

1. **Pre hook** — spawns a detached background process that polls `GET /rate_limit` with adaptive scheduling
2. **Main** — no-op (your workflow steps run here)
3. **Post hook** — kills the poller, performs a final poll, and writes a summary to `$GITHUB_STEP_SUMMARY`

The poller uses constant-space aggregation — it tracks per-bucket deltas across reset windows without storing historical samples.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | No | `${{ github.token }}` | GitHub token for API authentication |

## Outputs

| Output | Description |
|--------|-------------|
| `state_json` | Finalized reducer state as a JSON string |
| `poll_log_json` | Poll log entries as a JSON array string |

### Using outputs in downstream steps

```yaml
- uses: hesreallyhim/github-api-usage-monitor@main
  id: monitor

- name: Check usage
  run: |
    echo '${{ steps.monitor.outputs.state_json }}' | jq '.buckets.core.total_used'
```

## Example Summary Output

The action writes a markdown table to the GitHub step summary:

> **Duration:** 5m 32s | **Polls:** 12 | **Failures:** 0
>
> | Bucket | Used (this job) | Remaining | Limit | Windows Crossed |
> |--------|---------------:|----------:|------:|:-:|
> | core | 47 | 4,953 | 5,000 | 0 |
> | graphql | 12 | 4,988 | 5,000 | 0 |
> | search | 3 | 27 | 30 | 1 |

## Supported Platforms

- Linux (GitHub-hosted runners)
- macOS (GitHub-hosted runners)

Windows is not supported (the action will fail fast with a clear error).

## Limitations

- **Shared rate-limit pool** — all jobs in a repository share the same token's rate limits. If concurrent workflows run, usage from other jobs will appear in the totals.
- **Polling resolution** — the adaptive poller targets polls near bucket resets, but there's an inherent ~3-5s uncertainty window. Usage between the last poll and a reset boundary may be missed.
- **No per-request attribution** — the action reports aggregate bucket usage, not which specific API calls consumed quota.

## Development

```bash
npm install
npm test              # Unit tests (vitest, 128 tests)
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run build:all     # Bundle all 4 entry points with ncc
```

## License

MIT
