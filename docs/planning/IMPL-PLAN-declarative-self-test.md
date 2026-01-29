# Plan: Declarative Self-Test Generator

## Overview

Replace the hand-written `self-test.yml` with a declarative scenario list + a TypeScript generator that produces the workflow YAML. Each scenario is a simple data object; the generator stamps out identical job structure for each.

## Design

### Scenario type

```typescript
interface Endpoint {
  url: string;           // URL template, e.g. "/repos/${REPO}"
  method: "GET" | "POST";
  body?: string;         // For POST (graphql)
  contentType?: string;  // For POST
  bucket: string;        // Which rate-limit bucket this touches
}

interface BucketExpectation {
  total_used_delta: number;       // Exact calls we make to this bucket
  windows_crossed_max: number;    // Upper bound (0 for 60-min, 0-1 for 60-sec)
}

interface Scenario {
  id: string;                     // Job ID, e.g. "core-5"
  name: string;                   // Human label, e.g. "5 core GET calls"
  endpoints: Endpoint[];          // What to call
  calls_per_endpoint: number;     // Loop count per endpoint
  inter_call_sleep_s: number;     // Sleep between calls
  poll_duration_s: number;        // How long to let the poller run total
  expected: Record<string, BucketExpectation>;
}
```

### Shared constants

```typescript
const ENDPOINTS = {
  core: {
    url: "https://api.github.com/repos/${REPO}",
    method: "GET" as const,
    bucket: "core",
  },
  search: {
    url: "https://api.github.com/search/repositories?q=test",
    method: "GET" as const,
    bucket: "search",
  },
  code_search: {
    url: "https://api.github.com/search/code?q=test+repo:${REPO}",
    method: "GET" as const,
    bucket: "code_search",
  },
  graphql: {
    url: "https://api.github.com/graphql",
    method: "POST" as const,
    body: '{"query":"{ viewer { login } }"}',
    contentType: "application/json",
    bucket: "graphql",
  },
};
```

### Scenario list (10-15 scenarios)

```
#   ID                   Endpoints        Calls  Sleep  Duration  What it proves
──  ───────────────────  ───────────────  ─────  ─────  ────────  ──────────────────────────────
 1  baseline             (none)             0      —      90s     Infrastructure noise floor
 2  core-5               core               5      2s     90s     Basic core delta counting
 3  core-10              core              10      1s     90s     Linear scaling
 4  search-2             search             2      3s     90s     60-sec bucket counting
 5  code-search-2        code_search        2      3s     90s     Separate code_search bucket
 6  graphql-2            graphql            2      3s     90s     GraphQL point counting
 7  mixed-small          core+search+gql  2+2+2   2s    120s     Multi-bucket simultaneous
 8  core-burst           core               5      0s     90s     Rapid-fire (no inter-call sleep)
 9  search-window-cross  search             2      65s   150s     Force 60-sec window crossing
10  idle-check           (none)             0      —     120s     Longer idle; no spurious crossings
11  core-then-search     core, search     3, 2     2s    120s     Sequential multi-bucket
12  graphql-5            graphql            5      2s     90s     Higher graphql usage
```

Key design choices:
- **60-sec buckets get 2 calls max** (cautious; avoids secondary rate limit triggers)
- **Scenario 9** (`search-window-cross`) sleeps 65s between 2 search calls to force a window crossing — `total_used=2, windows_crossed=1`
- **Scenario 10** (`idle-check`) runs long with 0 calls to verify idle buckets don't show spurious crossings
- **Scenario 8** (`core-burst`) tests rapid-fire with 0 inter-call sleep
- All scenarios track/summarize **all 14 buckets**, even ones not queried — non-queried buckets assert `total_used_delta=0`

### Generator output

For each scenario, the generator produces an identical job shape:

```yaml
{scenario.id}:
  runs-on: ubuntu-latest
  needs: [{previous scenario id}]   # Linear chain
  steps:
    - uses: actions/checkout@v4

    - name: Start monitor
      uses: ./
      with:
        token: ${{ secrets.GITHUB_TOKEN }}

    - name: "Scenario: {scenario.name}"
      env:
        TOKEN: ${{ secrets.GITHUB_TOKEN }}
        REPO: ${{ github.repository }}
      run: |
        # Generated: {calls_per_endpoint} calls to {endpoint list}
        {for each endpoint, a bash loop}

    - name: Wait for polls ({poll_duration_s}s total)
      run: sleep {computed_remaining_sleep}

    - name: Dump state.json
      run: |
        STATE_FILE="${RUNNER_TEMP}/github-api-usage-monitor/state.json"
        echo "=== {scenario.id}: state.json ==="
        if [ -f "$STATE_FILE" ]; then
          cat "$STATE_FILE" | python3 -m json.tool
        else
          echo "state.json not found"
        fi
```

### Validation step (toggleable)

The workflow exposes an input `strict_validation` (default: `false`). When enabled, the generator emits an extra step per job that:

1. Reads `state.json` with `python3 -c` (no jq dependency needed on runners)
2. Extracts `total_used` for each expected bucket
3. Compares against scenario's `total_used_delta` (as `>=` for core due to noise, `==` for search/graphql)
4. Checks `windows_crossed <= windows_crossed_max`
5. Exits 1 on mismatch

When `strict_validation` is false, the step is skipped (or emitted with `if: inputs.strict_validation == 'true'`).

### Workflow shell

```yaml
name: Self-Test
on:
  workflow_dispatch:
    inputs:
      strict_validation:
        description: "Fail jobs on assertion mismatch"
        type: boolean
        default: false

concurrency:
  group: self-test
  cancel-in-progress: true

jobs:
  {generated jobs, linear chain via needs:}
```

## Files to create / modify

| File | Action | Purpose |
|------|--------|---------|
| `scripts/generate-self-test.ts` | Create | Generator script |
| `scripts/scenarios.ts` | Create | Declarative scenario definitions |
| `.github/workflows/self-test.yml` | Regenerate | Output of generator |

### Generator script (`scripts/generate-self-test.ts`)

- Reads scenarios from `scenarios.ts`
- Produces YAML string
- Writes to `.github/workflows/self-test.yml`
- Run via: `npx tsx scripts/generate-self-test.ts`

### Why TypeScript (not YAML)?

- Type-safe scenario definitions (interface enforcement)
- Shared `ENDPOINTS` constant avoids curl template duplication
- Can compute derived values (remaining sleep = poll_duration - call_time)
- Can validate scenarios at generation time (e.g. "60-sec bucket calls ≤ 5")
- Scenarios and generator live in same language as the project

## Verification

1. `npx tsx scripts/generate-self-test.ts` produces valid YAML
2. Generated workflow matches expected structure (spot-check a few jobs)
3. `git diff .github/workflows/self-test.yml` shows the transformation
4. Manual dispatch of the workflow on GitHub runs all scenarios sequentially
5. Each scenario's state.json dump matches expected `total_used_delta` and `windows_crossed_max`
