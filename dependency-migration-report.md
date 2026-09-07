# Dependency migration report

Date: 2026-09-07

## Updated packages

- `eslint`: 10.9.1 → 10.10.0
- `vitest`: 4.1.11 → 5.0.0
- `@vitest/coverage-v8`: 4.1.11 → 5.0.0

The Vitest packages were updated together because they require matching major versions. Their Node 24 support matches the project's `>=24.0.0` engine constraint.

## Deferred major update

`typescript` 7.0.2 remains deferred. `@typescript-eslint` 8.69.0 declares TypeScript support only below 6.1, so moving to TypeScript 7 would create an unsupported lint/typecheck toolchain. Upgrade TypeScript after a compatible `@typescript-eslint` release is available.

## Validation

- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm run test:all` — passed (266 unit tests and 6 integration tests)
- `npm run build:all` — passed
- `npm audit --json` — 0 vulnerabilities

## Rollback

Revert the dependency update commit to restore the prior package manifest and lockfile.
