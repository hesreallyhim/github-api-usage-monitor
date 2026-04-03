# Versioning & Runtime Policy (GitHub Action)

This repository publishes a Node.js–based GitHub Action to the Marketplace.  
This document defines the supported runtime contract, dependency constraints, and release guarantees.

---

## 1. Node.js support contract

- Supported Node.js versions: **>= 24**
- Action runtime: `runs.using: node24`
- Development and CI target: **Node 24.x**

**Rationale**
- GitHub-hosted runners execute `node24`, which floats across the 24.x line.
- We support a major version contract, not a specific patch.
- A JavaScript action runtime major bump (for example `node20` to `node24`) is treated as a breaking change for release purposes because older GHES or self-hosted environments may not support the newer runtime.
- Patch-level guarantees are neither tested nor enforced and are therefore not claimed.

**Configuration**
```json
// package.json
{
  "engines": {
    "node": ">=24"
  }
}
```

---

## 2. Node version files (`.nvmrc` and `.node-version`)

This repository includes both `.nvmrc` and `.node-version` to support multiple Node version managers and tooling ecosystems.

- Canonical source: `.nvmrc`
- Accepted value: major only (e.g. `24`)
- Policy: both files must match exactly

```
.nvmrc
24

.node-version
24
```

**Rationale**
- `nvm` consumes `.nvmrc`.
- Other tooling (asdf, mise, editors, some CI systems) consumes `.node-version`.
- Using the major only aligns with the project’s Node support contract (`>=24` / `24.x`).
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
  - `24.x` (contract baseline; runs unit + integration tests)
  - newer majors optionally for early warning (unit tests only)

**Job structure**
- `node-24` job runs the full suite (unit + integration) because integration tests are expensive.
- The matrix job (24.x/25.x) runs unit tests only for faster feedback on newer majors.

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
  - `vX` and `vX.Y` moving tags, force-updated on each release

**Rationale**
- GitHub Action consumers should be able to pin to a major (`@v1`) while receiving compatible updates.
- Release Please is the single source of truth for versions and changelogs.
- Moving tags are managed by the release workflow via `git tag -f` + `git push -f` when a release is actually created.

**Protocol**
- Only the Release Please workflow updates `vX` and `vX.Y`.
- Moving tags are updated only on release creation (not on release PR creation).
- Do not create or move `vX`/`vX.Y` manually; if a manual release is needed, use a `Release-As: X.Y.Z` commit to drive Release Please.

**Example (Release-As footer)**
```
chore: add social preview images

Release-As: 1.1.1
```

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

- Node support: `>=24`
- Action runtime: `node24`
- Dev default: `24.x`
- Dependency enforcement: lockfile + `engine-strict=true`
- Quality gate: CI + branch protection
- Releases: Release Please + semantic versioning

This setup prioritizes reproducibility, Marketplace expectations, and explicit guarantees without over-specifying unsupported constraints.
