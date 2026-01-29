# Dependency Migration Report

**Date:** 2026-01-29
**Branch:** `update-deps`
**Baseline commit:** `c237aad`
**Migration commit:** `04bfbc4`

## Summary

All 9 outdated dependencies upgraded to their latest versions, including 2 major version bumps. No code changes were required.

## Upgrades Applied

### Major Version Bumps

| Package | From | To | Notes |
|---------|------|-----|-------|
| `@actions/core` | ^2.0.2 | ^3.0.0 | Breaking change: ESM-only. Project already uses `"type": "module"` — no migration needed. |
| `@actions/github` | ^7.0.0 | ^9.0.0 | Not imported anywhere in source code; devDependency only. No impact. |

### Minor/Patch Bumps

| Package | From | To |
|---------|------|-----|
| `@types/node` | ^25.0.10 | ^25.1.0 |
| `@typescript-eslint/eslint-plugin` | ^8.53.1 | ^8.54.0 |
| `@typescript-eslint/parser` | ^8.53.1 | ^8.54.0 |
| `@vercel/ncc` | ^0.38.1 | ^0.38.4 |
| `globals` | ^17.1.0 | ^17.2.0 |
| `typescript` | ^5.3.3 | ^5.9.3 |
| `typescript-eslint` | ^8.53.1 | ^8.54.0 |

## Validation Results

| Gate | Status |
|------|--------|
| TypeScript typecheck (`tsc --noEmit`) | Pass |
| ESLint (`eslint src test`) | Pass |
| Unit tests (`vitest run`) | Pass (92/92) |
| Build (`npm run build:all`) | Pass (4 bundles) |

## Rollback Plan

To revert all changes:

```bash
git revert <migration-commit-hash>
rm -rf node_modules package-lock.json
npm install
```

## Notes

- `package-lock.json` was regenerated from scratch (deleted and reinstalled) to resolve peer dependency conflicts between `@typescript-eslint/*` packages.
- `npm audit` reports 0 vulnerabilities.
