# Versioning & Runtime Policy (GitHub Action)

This repository publishes a Node.js–based GitHub Action to the Marketplace.  
This document defines the supported runtime contract, dependency constraints, and release guarantees.

---

## 1. Node.js support contract

- Supported Node.js versions: **>= 20**
- Action runtime: `runs.using: node20`
- Development and CI target: **Node 20.x**

**Rationale**
- GitHub-hosted runners execute `node20`, which floats across the 20.x line.
- We support a major version contract, not a specific patch.
- Patch-level guarantees are neither tested nor enforced and are therefore not claimed.

**Configuration**
```json
// package.json
{
  "engines": {
    "node": ">=20"
  }
}
```

---

## 2. Node version files (`.nvmrc` and `.node-version`)

This repository includes both `.nvmrc` and `.node-version` to support multiple Node version managers and tooling ecosystems.

- Canonical source: `.nvmrc`
- Accepted value: major only (e.g. `20`)
- Policy: both files must match exactly

```
.nvmrc
20

.node-version
20
```

**Rationale**
- `nvm` consumes `.nvmrc`.
- Other tooling (asdf, mise, editors, some CI systems) consumes `.node-version`.
- Using the major only aligns with the project’s Node support contract (`>=20` / `20.x`).
- Keeping both files synchronized prevents environment drift across tools.

**Enforcement**
A CI check ensures the files never diverge:

```json
"test:nvm-matches": "\"$(cat .nvmrc | tr -d ' \n\r')\"" = "\"$(cat .node-version | tr -d ' \n\r')\""
```

---

## 3. npm configuration (`.npmrc`)

This repository commits an `.npmrc` file with strict engine enforcement enabled.

```
engine-strict=true
```

**Rationale**
- `engines.node` in `package.json` is advisory by default.
- `engine-strict=true` causes `npm install` / `npm ci` to fail if any direct or transitive dependency declares an incompatible Node engine.
- This enforces the Node support contract at install time.

**Enforcement**
- CI uses `npm ci`.
- Incompatible dependency updates fail deterministically.
- Dependabot PRs are subject to the same enforcement.

---

## 4. Dependency versioning

- A lockfile (`package-lock.json`) is committed.
- CI installs dependencies using `npm ci`.
- SemVer ranges are permitted in `package.json` for direct dependencies.

**Rationale**
- The lockfile provides full transitive reproducibility.
- Deterministic installs are the recommended supply-chain practice.
- Hard-pinning all dependencies in `package.json` adds maintenance overhead without additional safety beyond the lockfile.

---

## 5. Continuous Integration (CI)

- CI runs on:
  - `pull_request` to `main`
  - `push` to `main`
- Required checks (via branch protection):
  - Typecheck
  - Lint
  - Tests
  - Build
  - `dist/` verification (`git diff --exit-code -- dist`)
  - Self-test workflow generation verification (`npm run generate:self-test` + diff)
- Node matrix includes at minimum:
  - `20.x` (contract baseline; runs unit + integration tests)
  - newer majors optionally for early warning (unit tests only)

**Job structure**
- `node-20` job runs the full suite (unit + integration) because integration tests are expensive.
- The matrix job (22.x/24.x) runs unit tests only for faster feedback on newer majors.

**Rationale**
- CI guarantees that any commit merged to `main` is buildable, tested, and has up-to-date bundled output.
- Patch-level Node testing is intentionally out of scope.

---

## 6. Pull request hygiene

- All PR titles must follow **Conventional Commits**.
- Enforced via semantic PR linting.
- Dependabot PRs are configured to comply with Conventional Commits.

**Rationale**
- Conventional commits are required for automated versioning and changelog generation.

---

## 7. Releases and tagging

- Releases are automated using Release Please.
- Release Please runs on `push` to `main` (and manual dispatch).
- Version tags:
  - `vX.Y.Z` (annotated release tag)
  - `vX` (and optionally `vX.Y`) advanced on release

**Rationale**
- GitHub Action consumers should be able to pin to a major (`@v1`) while receiving compatible updates.
- Release Please is the single source of truth for versions and changelogs.

---

## 8. Dependabot

- Dependabot PRs:
  - Use Conventional Commit titles.
  - Must pass CI and `dist/` verification before merge.
- Release Please consumes Dependabot commits like any other change.

**Rationale**
- Dependency updates are validated and released using the same guarantees as human-authored changes.

---

## Summary

- Node support: `>=20`
- Action runtime: `node20`
- Dev default: `20.x`
- Dependency enforcement: lockfile + `engine-strict=true`
- Quality gate: CI + branch protection
- Releases: Release Please + semantic versioning

This setup prioritizes reproducibility, Marketplace expectations, and explicit guarantees without over-specifying unsupported constraints.
