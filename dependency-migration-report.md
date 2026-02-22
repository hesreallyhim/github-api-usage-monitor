# Dependency Migration Report

**Date**: 2026-02-22
**Branch**: `chore/deps-upgrade-2026-02-22`
**Baseline commit**: `492f199`
**Runtime**: Node 20.19.6, npm 10.8.2

## Changes Applied

| Package | From | To | Bump | Dependabot PR |
|---------|------|----|------|---------------|
| `@types/node` | 20.19.30 | 20.19.33 | patch | — |
| `@typescript-eslint/eslint-plugin` | 8.54.0 | 8.56.0 | minor | #19 |
| `@typescript-eslint/parser` | 8.54.0 | 8.56.0 | minor | #18 |
| `typescript-eslint` | 8.54.0 | 8.56.0 | minor | #20 |

## Validation Results

| Gate | Status |
|------|--------|
| `prettier --check` | Pass |
| `eslint` | Pass |
| `tsc --noEmit` | Pass |
| `vitest run` (261 tests) | Pass |
| `npm run build:all` (4 bundles) | Pass |

## Deferred Upgrades

### eslint 9.39.2 → 10.0.0 (PR #17)

Major version with significant breaking changes:
- Removed deprecated `SourceCode` methods and rule context methods
- Removed eslintrc support (flat config only — already in use here)
- New Node.js engine requirement: `^20.19.0 || ^22.13.0 || >=24`
- Updated `eslint:recommended` configuration
- Replaced `chalk` with `styleText`

**Recommendation**: Dedicate a separate PR. The eslint config already uses flat
config, so the migration should be straightforward, but `@eslint/js`,
`typescript-eslint`, and `eslint-config-prettier` will all need compatible
versions verified.

### @types/node 20.19.30 → 25.2.3 (PR #21)

Major version jump from Node 20 types to Node 25 types. Since `action.yml`
uses the `node20` runtime, `.nvmrc` specifies `20`, and `engines` says `>=20`,
this would provide type definitions for APIs unavailable in the actual runtime.

**Recommendation**: Keep on the `@types/node@20.x` track. Close PR #21 or
configure dependabot to ignore major bumps on this package.

### undici + fast-xml-parser (PR #23 — security)

These are transitive dependencies nested inside `@actions/artifact@5.x`. The
`undici` vulnerability (GHSA-g9mf-h72j-4rw9, CVE-2026-22036) is moderate
severity (unbounded decompression chain). Fixing requires `@actions/artifact@6`,
which is a breaking change.

19 vulnerabilities remain in the `@actions/artifact` transitive tree (archiver,
minimatch, undici). All require a major bump to `@actions/artifact` to resolve.

**Recommendation**: Upgrade `@actions/artifact` to v6 in a dedicated PR with
API migration review.

## Rollback

```bash
git checkout 492f199 -- package.json package-lock.json
npm install
npm run build:all
```

## CI Workflows

The following GitHub Actions workflows should pass on this branch:
- `ci.yml` (lint, typecheck, test, build)
- `self-test.yml` (action self-test scenarios)
