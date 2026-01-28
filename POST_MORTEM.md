# POST_MORTEM — Bundling + Self-Test Failures

**Date:** 2026-01-28  
**Scope:** github-api-usage-monitor action build + self-test workflows  

## Summary

Multiple failures occurred while running the self-test workflow and rebuilding `dist`. The primary issues were ESM incompatibilities, non-deterministic build artifacts, and an ncc bundling feedback loop that recursively embedded `dist` inside itself.

## Impact

- Self-test failed at startup (`__dirname is not defined`).
- Poller startup verification timed out.
- `dist` became recursively nested (`dist/github-api-usage-monitor/...`).
- CI check `git diff --exit-code -- dist` failed due to non-deterministic artifacts.

## Timeline (Condensed)

- Self-test failed with `__dirname is not defined` in both start and stop.
- First fix used `import.meta.url`, which triggered ncc asset-path rewriting.
- Rebuilding `dist` created recursive `dist/github-api-usage-monitor/...` nesting.
- CI “dist up to date” check failed due to `.map` diffs.
- Rebuilds compounded the nested output.

## Root Causes

1. **ESM `__dirname` usage**
   - The action bundles to ESM, where `__dirname` is undefined.
   - Spawned poller path resolution failed.

2. **ncc asset-path feedback loop**
   - `spawnPoller` resolved `dist/poller/index.js` inside code that is itself bundled.
   - ncc rewrote the path to an asset base (`__nccwpck_require__.ab + "github-api-usage-monitor/" + baseDir + ...`).
   - Because `baseDir` already pointed to `dist`, ncc copied `dist` into itself.
   - Each rebuild embedded the prior nested tree again (recursive growth).

3. **Non-deterministic source maps**
   - Source maps and declaration maps embed absolute file paths.
   - Builds on different machines/paths produced diffs even with identical JS output.

4. **Poller startup timeout**
   - Poller never wrote `poller_started_at_ts` because the spawn path was broken.

## Fixes Applied

- **Poller path resolution:** avoid `__dirname` and `import.meta.url` in bundled code; build the poller entry path from `GITHUB_ACTION_PATH`/`process.argv[1]` and avoid `path.resolve` so ncc doesn’t treat it as an asset path.
- **Drop ncc sourcemaps:** removed `--source-map` from build scripts.
- **Clean rebuild:** `npm run clean && npm run build:all` to eliminate nested artifacts.

## Remaining Risks / Follow-ups

- **TypeScript declaration maps** are still emitted (`.d.ts.map`) and include absolute paths; they can still cause `dist` diffs in CI.
  - **Option:** set `declarationMap: false` and `sourceMap: false` in `tsconfig.json` to make `dist` fully deterministic.
- **Detached poller on cancel:** max-lifetime is 6 hours; consider reducing or adding a heartbeat after v1.

## Recommended Plan (Short-Term)

1. Disable TS declaration/source maps (optional but recommended for deterministic `dist`).
2. Rebuild `dist` cleanly.
3. Re-run self-test and CI to confirm no `dist` diffs and no poller spawn failures.

## Notes

- `pre` hooks do not run for **local actions** (`uses: ./`), which affects self-test strategy.
- For marketplace usage, `pre`/`post` are viable; for local testing, `main` must still start the monitor.
