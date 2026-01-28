# ADR-001: Replace mode input with post hook

**Status:** Proposed
**Date:** 2026-01-25

## Context

The current action requires users to call it twice with `mode: start` and `mode: stop`:

```yaml
- uses: owner/github-api-usage-monitor@v1
  with:
    mode: start

# ... workflow steps ...

- uses: owner/github-api-usage-monitor@v1
  if: always()
  with:
    mode: stop
```

This design has several problems:

1. **User friction**: Two steps instead of one
2. **Easy to forget `always()`**: If omitted, stop never runs on failure
3. **Orphan process risk**: If start succeeds but PID write fails, no cleanup path
4. **Complex error handling**: Start and stop are separate invocations with no shared context

GitHub Actions supports a `post` entry point that runs automatically after the job completes, regardless of job status.

## Decision

Replace the `mode` input with automatic lifecycle management:

```yaml
# action.yml
runs:
  using: node20
  main: dist/main.js      # spawns poller, writes state
  post: dist/post.js      # kills poller, renders summary
  post-if: always()
```

User workflow becomes:

```yaml
- uses: owner/github-api-usage-monitor@v1
```

Single step. No mode. No `if: always()` required.

## Implementation

1. **Remove** `mode` input from action.yml
2. **Rename** `handleStart()` logic → `dist/main.js` entry point
3. **Create** `src/post.ts` with `handleStop()` logic → `dist/post.js`
4. **Update** build script to bundle both entry points
5. **Simplify** error handling: post always attempts cleanup

### Entry points after refactor

| File | Runs | Responsibility |
|------|------|----------------|
| `src/main.ts` | On action call | Validate, initial poll, spawn poller, save PID |
| `src/post.ts` | After job | Kill poller, read state, render summary |

## Consequences

### Positive

- **Simpler UX**: One step instead of two
- **Guaranteed cleanup**: `post-if: always()` is built into action.yml, not user responsibility
- **Orphan recovery**: Even if main fails after spawn, post still runs
- **Cleaner code**: No mode dispatch logic

### Negative

- **Less flexibility**: Users cannot control when stop runs (always runs at job end)
- **Longer gap**: Summary appears at job end, not immediately after monitored steps

### Neutral

- **Breaking change**: v1 users would need to update workflow (acceptable pre-release)
- **Two bundles**: Already have `dist/main.js` and `dist/poller/index.js`; adding `dist/post.js` is consistent

## Alternatives Considered

1. **Keep mode input**: Rejected due to UX friction and orphan risks
2. **Composite action wrapper**: Would obscure individual steps, harder to debug
3. **State file as signal**: Post checks for state file existence instead of explicit mode; considered but explicit entry points are clearer

## References

- [GitHub Actions post entry point](https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#runspost)
- Critical code review identifying orphan process risk (2026-01-25)
