# ADR-004: Self-test cannot test feature branches

**Status:** Open
**Date:** 2026-01-29

## Context

The self-test workflow (`.github/workflows/self-test.yml`) is a critical part of the project — it validates that the monitor action correctly observes rate-limit usage across 12 scenarios on real GitHub infrastructure.

Two constraints interact to create a gap in test coverage:

### 1. In-repo actions skip the pre hook

GitHub Actions workflows that reference an action defined in the same repository via `uses: ./` do **not** execute the `pre` hook. Since this action depends on `pre.ts` to start the background poller, `uses: ./` causes every scenario to silently fail — the poller never starts, so `state.json` is never written.

The workaround is to reference the action externally:

```yaml
uses: hesreallyhim/github-api-usage-monitor@main
```

This fires the pre hook correctly.

### 2. External references are pinned to a specific ref

The `uses:` field requires a literal ref (branch, tag, or SHA). It does not support expressions like `${{ github.ref_name }}`. Workflow input defaults also cannot contain expressions.

This means the workflow is currently hardcoded to test `@main`. There is an `action_ref` input that can be overridden manually, but:

- Developers must remember to set it when testing branches
- The default (`main`) may not reflect the code being validated
- There is no automatic way to test the current branch's action code

## Current state

The generator produces `uses: hesreallyhim/github-api-usage-monitor@${{ inputs.action_ref }}` with `action_ref` defaulting to `main`. This is correct for mainline validation but means feature branches are not automatically tested.

## Options under consideration

### A. Resolve job

Add a first job that computes the effective ref (defaulting to `github.ref_name` when the input is empty) and outputs it. Downstream jobs read the output. This works but adds a job to the chain and couples all jobs to it.

### B. Dedicated test repository

Create a separate repository whose sole purpose is to run the self-test workflow against this action. The test repo would reference `hesreallyhim/github-api-usage-monitor@<ref>` and could be triggered via `repository_dispatch` from CI on this repo. This also solves the cross-workflow rate-limit noise problem (separate repo = separate token pool).

### C. Composite action wrapper

Wrap the action in a composite action that explicitly runs the pre/main/post scripts in sequence, bypassing the lifecycle hook limitation. This avoids the external reference entirely but diverges from the real action lifecycle.

### D. GitHub-hosted action testing (if/when available)

GitHub may eventually support pre hooks for in-repo action references. Monitor for changes.

## Decision

Deferred. Currently using option A in its simplest form (manual `action_ref` override, default `main`). Option B (dedicated test repo) is likely the right long-term solution as it also addresses rate-limit pool isolation.

## Impact

- **Feature branches are not automatically validated** by the self-test unless the developer manually dispatches with `action_ref` set to their branch
- **Main branch is always tested correctly** via the default
- This is an acceptable gap for now but should be resolved before the action is published for external use
