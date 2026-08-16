# Dependency Migration Report - 2026-08-16

## Scope

This migration consolidates the installable updates from the six Dependabot pull requests that were open against `main` on 2026-08-16. It also enables grouped Dependabot pull requests for future minor and patch updates.

Baseline commit: `d044cc118ffc4fa6c44720cf9a9c3a2171abfc49`

Branch: `codex/consolidate-dependabot-20260816`

## Applied updates

| Dependency | Previous | Applied | Source PR | Notes |
| --- | --- | --- | --- | --- |
| `github/codeql-action/upload-sarif` | 4.37.3 | 4.37.7 | #141 proposed 4.37.6 | Advanced to the latest patch and pinned the dereferenced tag commit. |
| `@types/node` | 26.1.2 | 26.2.0 | #140 | Latest available version. |
| `eslint` | 10.8.0 | 10.8.1 | #139 | Latest available version. |
| `tsx` | 4.23.5 | 4.23.12 | #138 proposed 4.23.11 | Advanced to the latest patch. |
| `actions/setup-node` | 6.4.0 | 7.0.0 | #128 | Major upgrade, pinned to the verified `v7.0.0` commit. |
| `nanoid` | 3.3.17 | 3.3.18 | Existing transitive advisory | Resolves GHSA-2v37-7h3g-55p8; `npm audit` now reports zero vulnerabilities. |

The full bundle and self-test workflow generators were rerun. They produced no changes, confirming that the committed generated outputs remain current.

## Dependabot grouping

Minor and patch updates are now grouped independently for the npm and GitHub Actions ecosystems. Major upgrades remain standalone so an incompatible major release cannot block routine maintenance updates.

## Deferred update

TypeScript 7.0.2 from #137 is not included. The exact Dependabot branch fails both remotely and locally during `npm ci` because the latest available `typescript-eslint` 8.67.0 packages declare a TypeScript peer range of `>=4.8.4 <6.1.0`.

Forcing installation with `--force`, `--legacy-peer-deps`, or an override would suppress npm's compatibility check while leaving the lint/parser stack outside its supported range. TypeScript should remain at 6.0.3 until `typescript-eslint` publishes TypeScript 7 support.

## Validation

Node 24.18.0 with npm 11.16.0:

- `npm ci`
- `npm run build:all`
- `npm run generate:self-test`
- `npm run format:check`
- `npm run typecheck`
- `npm run lint`
- `npm run test:coverage` - 266 tests passed; 91.57% statement coverage
- `npm run test:all` - 266 unit tests and 6 integration tests passed
- `npm audit` - zero vulnerabilities
- `git diff --check`

Node 25.8.1 with npm 11.11.0:

- `npm ci`
- `npm run build:all`
- `npm run generate:self-test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:coverage` - 266 tests passed; 91.57% statement coverage

## Rollback

Revert the migration commit, run `npm ci` under Node 24, and run `npm run build:all` to restore the previous dependency graph and generated bundles.

## Required CI

The `CI` workflow should pass both Node 24.x and Node 25.x build lanes, including the Node 24 integration suite. The Scorecard workflow should verify the updated CodeQL upload action in its normal scheduled or branch-triggered execution context.
