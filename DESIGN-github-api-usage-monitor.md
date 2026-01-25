# github-api-usage-monitor v1 — Monitor Rewrite Design Doc

**Status:** Draft (implementation-ready)  
**Target:** GitHub Marketplace release (v1 monitor-only)  
**Primary audience:** Implementing agent / maintainer

---

## 1. Summary

This v1 redesign replaces the original snapshot-diff approach with a **job-long monitor** that polls GitHub’s `GET /rate_limit` endpoint at a fixed interval and maintains a **constant-space aggregator** to estimate **primary rate-limit consumption by bucket** over the job’s duration.

The design is intentionally narrow:
- **No endpoint tracing**
- **No secondary rate-limit inference**
- **No complex configuration**
- **Linux/macOS GitHub-hosted runners only** (Windows/container/self-hosted are out of scope for v1)

The core complexity is OS/process lifecycle (background monitor), correctness around reset boundaries, and reliable reporting.

---

## 2. Goals and Non-Goals

### Goals
1. **Reliable bucket-level accounting** of primary rate-limit usage during a job (hour- and minute-buckets).
2. **Correctness across reset boundaries** (fixed-duration windows anchored at first use per bucket).
3. **Minimal user friction**: two steps (start, stop) added to a workflow; defaults are sane.
4. **Clear, actionable output**: per-bucket totals + warnings + remaining quota + next reset time.
5. **Safe by design**: no token leakage in logs; conservative polling cadence.

### Non-Goals
- Per-request endpoint tracing (URL/method) or per-step attribution.
- Secondary rate-limit diagnostics (burstiness, concurrency, abuse heuristics).
- Strong guarantees on job cancellation/runner crash (partial results acceptable).
- Full Windows support, job-level container support, self-hosted runner support (v1 explicitly not guaranteed).

---

## 3. Operating Model

### Key observation
GitHub rate limit buckets have independent fixed-duration windows. A bucket’s **reset timestamp is anchored when the bucket is first used**, then counts down to that absolute reset time; usage consumes quota but does not change the reset timestamp.

Therefore, v1 measures usage by sampling `used` (or `remaining`) and tracking deltas **within stable `reset` windows**.

---

## 4. User Experience (Workflow Integration)

### Minimal workflow usage (recommended)
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start API usage monitor
        uses: <OWNER>/github-api-usage-monitor@v1
        with:
          mode: start
          token: ${{ secrets.GITHUB_TOKEN }}   # default; optional

      - name: Build & test
        run: |
          make test

      - name: Stop API usage monitor and report
        if: ${{ always() }}
        uses: <OWNER>/github-api-usage-monitor@v1
        with:
          mode: stop
          token: ${{ secrets.GITHUB_TOKEN }}
```

**Defaults (v1):**
- `interval_seconds = 60`
- `supported runners = ubuntu-latest, macos-latest`
- `output = step summary + standard logs`

---

## 5. Architecture

### Components
1. **Start action**
   - Validates environment (Linux/macOS).
   - Starts a background poller process.
   - Writes PID + reducer state to `$RUNNER_TEMP`.

2. **Background poller**
   - Every `interval_seconds`:
     - Calls `GET https://api.github.com/rate_limit`
     - Parses buckets
     - Updates constant-space reducer state file atomically.

3. **Stop action**
   - Reads PID; terminates poller gracefully.
   - Loads reducer state.
   - Produces summary in:
     - GitHub step summary (`$GITHUB_STEP_SUMMARY`)
     - Console output (human-readable)

---

## 6. High-Level Diagram

```mermaid
flowchart LR
  A[Workflow Step: start] --> B[Spawn poller in background]
  B --> C[Poll /rate_limit every N seconds]
  C --> D[Update reducer state in RUNNER_TEMP]
  D --> C
  E[Workflow Steps: build/test/etc.] --- C
  F[Workflow Step: stop (always)] --> G[Kill poller using PID]
  G --> H[Read reducer state]
  H --> I[Write step summary + logs]
```

---

## 7. Data Model

### Rate-limit sample (logical)
We do **not** store full time series in v1. Each poll reads:
- `resources.<bucket>.limit`
- `resources.<bucket>.used`
- `resources.<bucket>.remaining`
- `resources.<bucket>.reset` (epoch seconds)

### Reducer state (constant-space)
Per bucket, track:
- `last_reset` (epoch)
- `last_used` (int)
- `total_used` (int) — aggregated usage across job duration
- `windows_crossed` (int)
- `anomalies` (int) — count of unexpected deltas
- `last_seen_ts` (ISO string) — optional, for debugging
Global:
- `started_at_ts`, `stopped_at_ts`
- `interval_seconds`
- `poll_count`, `poll_failures`
- `last_error` (string, optional)

State is stored as JSON at:
- `$RUNNER_TEMP/github-api-usage-monitor/state.json`

PID stored at:
- `$RUNNER_TEMP/github-api-usage-monitor/poller.pid`

---

## 8. Reducer Algorithm (Core Logic)

### Per poll, per bucket
Inputs: `reset`, `used`, `limit`, `remaining`, `ts`

Pseudo-code:
```text
if state[bucket] not initialized:
  state[bucket].last_reset = reset
  state[bucket].last_used = used
  continue

if reset == last_reset:
  delta = used - last_used
  if delta < 0:
    anomalies += 1
    delta = 0   # do not subtract from totals
  total_used += delta
else:
  windows_crossed += 1
  # boundary: do not attempt reconstruct missed time; accept bounded error by poll interval
  # v1 default: INCLUDE used on new window (since it happened after reset)
  total_used += used
  last_reset = reset

last_used = used
last_seen_ts = ts
```

**Design choice (v1): include `used` immediately after a reset change.**  
Rationale: that `used` reflects consumption since the new window began, and the poll happened after reset, therefore it is within the job interval and should count as job-observed usage. This minimizes undercount at reset boundaries.

### Error handling per poll
- If `/rate_limit` request fails:
  - `poll_failures += 1`
  - continue (do not modify per-bucket state)
- If parse fails:
  - treat as failure
- Optional single retry after short sleep (v1: **no retry** to keep logic simple; rely on next poll)

---

## 9. Outputs

### Step Summary (default)
- Header: “GitHub API Usage (Monitor) — Job Summary”
- Job run duration and poll count
- Table sorted by `total_used` desc:
  - bucket
  - total_used
  - windows_crossed
  - remaining (from last sample)
  - reset time (human-friendly UTC)
- Warnings section:
  - unsupported runner / OS
  - poll_failures > 0
  - anomalies > 0
  - monitor not stopped cleanly (PID missing, etc.)

Example table shape:

| Bucket | Used (job) | Windows crossed | Remaining | Resets at (UTC) |
|---|---:|---:|---:|---|

### Console output
- One-line summary + top 3 consuming buckets
- Warnings printed plainly (no huge logs)

---

## 10. Functional Requirements

1. **Start/Stop modes**
   - `mode=start` spawns poller and returns success if started.
   - `mode=stop` terminates poller and prints summary even if poller not running (best effort).

2. **Token**
   - Accept token input; default to `github.token` / `GITHUB_TOKEN` if present.
   - Never print token; avoid shell debug that echoes headers.

3. **Polling**
   - Default `interval_seconds=60`.
   - Enforce a minimum interval of 30 seconds if user overrides (v1 can omit override entirely; see NFRs).

4. **State persistence across steps**
   - Use `$RUNNER_TEMP` paths so both steps can access the state.

5. **Best-effort on failure**
   - Stop step should run with `always()`; if it runs, it should output something even when partial.

---

## 11. Non-Functional Requirements

### Security
- No secrets in logs.
- No `set -x` in shell stubs.
- Use GitHub masking behavior; do not print request headers.

### Reliability
- Poller process survives step boundaries on Linux/macOS GitHub-hosted runners.
- PID-based lifecycle management with best-effort cleanup.

### Performance
- Poll is lightweight; constant-space reducer O(#buckets) per poll.
- Minimal log volume.

### Maintainability
- Deterministic reducer behavior and unit-testable pure functions.

---

## 12. Risks and Mitigations

### Runner/Process Risks
- **Orphan process**: stop step may not run on cancel.
  - Mitigation: acceptable for v1; poller dies when job VM is torn down.
- **PID not found / stale PID**:
  - Mitigation: stop step handles gracefully; emits warning.
- **Background process across steps**:
  - Mitigation: explicitly scope v1 to GitHub-hosted Linux/macOS.
- **Windows differences**:
  - Mitigation: detect and fail-fast with clear message.

### API Risks
- `/rate_limit` transient failures:
  - Mitigation: count failures; show warning; proceed.
- Secondary rate limit of `/rate_limit` if polled too aggressively:
  - Mitigation: default 60s; do not go below 30s.

### Correctness Risks
- Reset boundary happens between polls:
  - Mitigation: bounded error by interval; include `used` after reset to reduce undercount.
- Token context changes mid-job:
  - Symptom: `used` decreases without reset, or limits jump unexpectedly.
  - Mitigation: record anomaly; do not subtract from totals; warn.

---

## 13. Implementation Plan (v1)

### Language / runtime
**Node 20** GitHub Action (TypeScript recommended) for cross-platform parity on Linux/macOS and simpler HTTP/JSON processing.

### Core files (proposed)
```
.
├─ action.yml
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ main.ts                # entry: dispatch start/stop by input
│  ├─ poller.ts              # spawn + poll loop (child process entry)
│  ├─ github.ts              # rate_limit fetch, request building
│  ├─ reducer.ts             # pure reducer logic + state model
│  ├─ state.ts               # read/write JSON atomically
│  ├─ output.ts              # step-summary rendering
│  ├─ paths.ts               # RUNNER_TEMP paths
│  └─ platform.ts            # OS detection / support checks
├─ test/
│  ├─ reducer.test.ts        # table-driven tests (reset, anomalies)
│  └─ fixtures/              # sample rate_limit payloads
└─ docs/
   ├─ ADR-001-monitor.md
   └─ DESIGN-v1.md           # (this doc)
```

### Process model (Node)
- `mode=start` launches `node dist/poller.js` detached and writes PID.
- `poller.js` runs loop and updates state file.
- `mode=stop` kills PID and prints summary.

**Detachment strategy**
- Use `child_process.spawn(process.execPath, [pollerEntry], { detached: true, stdio: 'ignore' })`
- Call `child.unref()`
- Store `child.pid`

### State atomicity
- Write to `state.json.tmp` then rename to `state.json` (atomic on POSIX).
- Keep state small.

---

## 14. Testing Strategy (v1)

### Unit tests (required)
- Reducer table-driven tests:
  - same reset monotonic used
  - reset change includes post-reset used
  - used decreases without reset => anomaly
  - poll failures => no state change
- Parsing tests using captured fixture payloads.

### Integration tests (recommended)
- GitHub Actions self-test workflow on:
  - ubuntu-latest
  - macos-latest
- Simulate API usage (call some REST endpoints) and verify totals > 0.

### CI/CD
- Standard build/test/lint pipeline
- Release automation:
  - `dist/` built artifacts committed or generated on release (choose one and document)

---

## 15. Open Items (v1 choices locked unless stated)

### Configuration
v1 defaults:
- `interval_seconds = 60` (no user override in v1, unless trivial to add)
- `token` input only
- `mode` input: `start|stop`

### Optional future enhancements (v2+)
- Optional JSONL time series artifact
- Windows support
- Endpoint tracing (opt-in)
- Step correlation (timestamp markers)

---

## 16. Action Interface (v1)

### Inputs
- `mode` (required): `start` or `stop`
- `token` (optional): defaults to `github.token` / `GITHUB_TOKEN`

### Outputs
- None (primary output is step summary + log)

---

## 17. Stub: `action.yml` (v1)

```yaml
name: github-api-usage-monitor
description: Monitor GitHub API rate-limit usage during a job by polling /rate_limit.
inputs:
  mode:
    description: start or stop the monitor
    required: true
  token:
    description: GitHub token (defaults to GITHUB_TOKEN)
    required: false
runs:
  using: node20
  main: dist/main.js
branding:
  icon: activity
  color: gray-dark
```

---

## 18. Stub: Summary Rendering (shape)

```text
GitHub API Usage (Monitor) — Job Summary
Duration: 12m 31s | Polls: 13 | Failures: 0

Top buckets by usage:
- core: 412 used | windows crossed: 0 | remaining: 4588 | reset: 2026-01-24T20:20:00Z
- search: 9 used | windows crossed: 7 | remaining: 21 | reset: 2026-01-24T19:40:37Z

Warnings:
- search window crossed multiple times; totals are interval-bounded (poll=60s)
```

---

## 19. Implementation Notes for v1 Simplicity

- Prefer **`used` deltas**, not `remaining` deltas, since `used` is monotonic within a window.
- Do not attempt perfect reconstruction across boundaries; rely on sampling and bounded error.
- Keep logs minimal; print final summary only.
- Encourage users to add stop step with `always()`.

---

**End of document**
