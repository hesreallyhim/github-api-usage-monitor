# Hierarchical Code Review Report — github-api-usage-monitor

**Date:** 2026-01-30
**Reviewer:** Claude Opus 4.5 (hierarchical-code-reviewer agent)
**Branch:** `claude`
**Commit:** `d73b36d`

---

## Executive Summary

This is a well-engineered, spec-driven GitHub Action with ~2,080 lines of source and ~2,460 lines of tests. Architecture is clean with clear layering, pure-function core logic, and disciplined separation of concerns. Strong engineering rigor is evident throughout: formal spec, ADRs, declarative self-test generator, atomic state persistence.

**Top strengths:** Pure reducer design, result discriminated unions, defensive parsing, adaptive polling algorithm, thorough documentation infrastructure.

**Top concerns:** 54% overall test coverage, empty README, a debug logging bug in `post.ts`, incomplete state validation.

---

## Documentation Assessment

- **Completeness:** Strong (with one glaring gap)
- **Accuracy:** Good (some staleness in HANDOFF.md)

### What exists and is excellent

- `CLAUDE.md` — thorough, well-structured project guide with architecture diagrams, commands, conventions, and key design patterns. De facto developer onboarding document.
- `HANDOFF.md` — good project status snapshot with implementation status table, architecture summary, and next steps.
- `spec/spec.json` — machine-readable authoritative specification covering requirements, layers, boundary types, milestones, and risks.
- `SPEC.md` — human-readable derived spec (13KB).
- `DESIGN-github-api-usage-monitor.md` — original design document.
- 4 ADRs documenting key architecture decisions (post-hook lifecycle, adaptive polling, declarative self-test generator, self-test branch testing).
- Incident report and post-mortem (`INCIDENT-2026-01-28-self-test.md`, `POST_MORTEM.md`, `RETRO.md`) — indicates operational maturity.

### The gap

- `README.md` contains only `# Github Activity Usage Monitor` and is otherwise empty. For a GitHub Action intended for public consumption, this is the single most impactful documentation issue. Users discovering the action on GitHub would have no usage instructions, no example workflow YAML, and no understanding of what it does.

### Staleness

- `HANDOFF.md` references `mode=start`/`mode=stop` which reflects the original two-step design. The actual implementation uses `pre`/`main`/`post` hooks via `action.yml`. The HANDOFF has not been updated to reflect this evolution.
- The `dist/` question ("Should dist/ be committed?") is answered in practice (it is committed) but HANDOFF still lists it as an open question.

---

## Architecture & Organization

- **Structure Alignment:** Excellent
- **Module Separation:** Very Good
- **Build Architecture:** Well-designed

### Directory structure mirrors layered architecture

```
Entry Layer:     pre.ts, main.ts, post.ts, start.ts
Poller Layer:    poller.ts, poller-entry.ts
Core Logic:      reducer.ts, state.ts
Infrastructure:  github.ts, output.ts, paths.ts, platform.ts, types.ts, utils.ts, poll-log.ts
```

### Key architecture observations

- Clear boundary between pure logic (reducer) and side-effectful code (state, github, poller).
- Types are centralized in `types.ts` with well-documented interfaces.
- `utils.ts` is appropriately minimal (two type guard functions).
- Four separate `ncc` bundles from distinct entry points is the correct approach for a GitHub Action with pre/main/post hooks plus a detached child process.
- The pre/main/post hook design (ADR-001) is elegant. The poller runs as a truly detached child process (`detached: true`, `unref()`), communicating exclusively through the filesystem (atomic JSON writes). This is a robust design for the GitHub Actions runtime where step processes come and go but `$RUNNER_TEMP` persists.

---

## Component Reviews

### types.ts (172 lines)

- **Interface Clarity:** Excellent
- All boundary types have JSDoc comments on every field.
- Constants are co-located with the types they serve.
- **Issue:** The `isARealObject` check in `utils.ts` does not reject arrays — `typeof [] === 'object'` returns true. This means `isValidSample([])` would pass the first check. In practice the `requiredFields.every()` check would catch this, but the type guard is semantically imprecise.

### reducer.ts (275 lines) — Strongest module

- **Interface Clarity:** Excellent
- **Extensibility:** Very Good
- **Test Coverage:** 100%
- All functions are pure — no side effects, no mutation of inputs.
- The `UpdateResult` discriminated union cleanly separates bucket state update from metadata.
- The "reset changed but used didn't drop" case (lines 111-130) handles GitHub's timestamp rotation — a subtle edge case that's well-documented and tested.
- 32 tests covering all edge cases including idle window expiry, multi-poll sequences, and anomaly detection.
- **Minor:** `createInitialState()` uses `new Date().toISOString()` directly, making it non-deterministic. Acceptable since it's only called from effectful code.

### state.ts (280 lines)

- **Interface Clarity:** Good
- **Test Coverage:** 61%
- Atomic write pattern (write-to-temp, rename) is correctly implemented. Temp file cleanup in the error path is good defensive coding.
- **Issue:** `isValidState` validates top-level fields but does NOT validate the shape of `BucketState` objects inside `buckets`. A corrupted state file with malformed bucket data would pass validation and potentially cause runtime errors downstream.
- **Issue:** The TODO on line 47 (`// TODO: Validate parsed state has correct shape`) is misleading — validation exists but is incomplete at the bucket level.
- **Issue:** Duplicated `sleep()` function (also in `poller.ts`). Should be extracted to `utils.ts`.

### github.ts (160 lines)

- **Interface Clarity:** Excellent
- **Test Coverage:** 90%
- `AbortController` timeout (10s) for preventing indefinite hangs.
- Defensive field-by-field parsing of API responses.
- Proper error categorization (HTTP, network, timeout, parse errors).
- **Minor issue:** `parseRateLimitResponse` returns `null` if ANY resource has an invalid sample. A single malformed bucket kills the entire poll. More resilient approach: skip invalid resources and proceed with valid ones.

### poller.ts (434 lines — largest file)

- **Interface Clarity:** Good
- **Test Coverage:** 20%
- Contains three distinct concerns: process lifecycle (lines 33-198), adaptive sleep planning (lines 200-293), and main polling loop (lines 295-434).
- The pure functions (`computeSleepPlan`, `applyDebounce`) are well-tested (20 tests), but process lifecycle and main loop have no unit coverage.
- **Issue:** `spawnPoller` (lines 56-60) constructs paths with manual string concatenation instead of `path.join()`.
- **Issue:** Both `killPoller` and `killPollerWithVerification` exist side by side — creates confusion about which to use. In practice usage is correct but could be documented.

### output.ts (217 lines)

- **Interface Clarity:** Very Good
- **Test Coverage:** 90%
- Clean rendering with separate markdown and console formatters.
- `getActiveBuckets` filter excluding idle buckets is a good UX decision.
- **Minor:** `formatDuration` truncates rather than rounds seconds.

### post.ts (174 lines)

- **Test Coverage:** 0% (tested via integration only)
- **Bug (line 125):** Debug log says `used=${bucket.last_used}, last_used=${bucket.last_used}` — both values are `bucket.last_used`. The first should be `first_used=${bucket.first_used}`.
- The `handlePost` function (~125 lines) with deeply nested logic would benefit from decomposition into smaller functions.

### pre.ts (32 lines) and start.ts (71 lines)

- **Test Coverage:** 0%
- Startup sequence is well-structured with proper cleanup on failure.
- `core.setSecret(token)` ensures token masking in logs.

### paths.ts (71 lines)

- **Test Coverage:** 63%
- Simple path resolution. `getStateDir` throws if `RUNNER_TEMP` is not set — correct fail-fast behavior.

### platform.ts (81 lines)

- **Test Coverage:** 100%
- Clean and complete.

### poll-log.ts (58 lines)

- **Test Coverage:** 0%
- JSONL append-only diagnostic log. Silently swallows errors, which is correct — diagnostic logging should never disrupt the poller.

### Self-Test Generator (scripts/scenarios.ts + generate-self-test.ts)

- **Quality:** Very Good
- 12 scenarios covering baseline, single-bucket deltas, multi-bucket, burst, window crossing, and idle patterns.
- Declarative design means adding a scenario is a data-only change.

---

## Code Quality Findings

### Overall Quality: Good

128 unit tests, all passing. TypeScript strict mode. ESLint with `no-explicit-any`. Prettier enforced.

### Positive patterns

1. **Result discriminated unions** — consistent `{ success: true, data } | { success: false, error }` across all I/O. Excellent for explicit, testable error handling.
2. **Pure functions for core logic** — reducer is entirely pure and stateless.
3. **Defensive parsing** — all external data validated before use.
4. **Atomic file operations** — write-then-rename prevents corruption.
5. **JSDoc on all public functions** with layer annotations and port declarations.

### Anti-patterns found

1. **Duplicated helpers** — `sleep()` defined in both `poller.ts` and `state.ts`. Test factories (`makeState`, `makeBucket`, etc.) duplicated across 4+ test files with slight variations.
2. **Inconsistent `as Error` casting** — error handling uses `err as Error` or `err as NodeJS.ErrnoException` throughout. A `toError(err: unknown): Error` utility would be safer.
3. **Missing return type annotations on test helpers** — per project conventions, these should have explicit return types.
4. **Spec drift** — `poller_started_at_ts` exists in the TypeScript interface but not in `spec.json`'s `ReducerState` definition.

### Test quality

| Suite | Tests | Assessment |
|---|---|---|
| reducer | 32 | Excellent — table-driven, covers all branches including subtle edge cases |
| github | 26 | Very good — fixture-based parsing plus mocked fetch |
| state | 18 | Good — uses real filesystem with temp directories |
| output | 20 | Good — covers markdown, console, and warning rendering |
| poller | 20 | Pure functions only; process lifecycle untested at unit level |
| integration | 5 | Covers basic poller lifecycle with real process spawning |

---

## Prioritized Improvements

### High Priority

1. **Write a proper README.md** — usage example (workflow YAML), inputs/outputs reference, example summary output, limitations.

2. **Fix debug log bug in `post.ts` line 125** — `used=${bucket.last_used}` should be `first_used=${bucket.first_used}`.
   ```typescript
   // Current (post.ts:125-126):
   `  ${name}: used=${bucket.last_used}, last_used=${bucket.last_used}, ` +
   // Should be:
   `  ${name}: first_used=${bucket.first_used}, last_used=${bucket.last_used}, ` +
   ```

3. **Improve state validation** — `isValidState` in `state.ts` should validate individual `BucketState` entries, not just check that `buckets` is an object.

### Medium Priority

4. **Increase test coverage for poller lifecycle** — `poller.ts` is at 20%. Path construction and error handling in `spawnPoller` should have unit tests.

5. **Fix path construction in `spawnPoller`** — replace manual separator logic (`poller.ts:59-60`) with `path.join(baseDir, 'poller', 'index.js')`.

6. **Extract shared test helpers** — create `test/helpers.ts` with `makeState`, `makeBucket`, `makeSample`, `makeResponse` factories.

7. **Deduplicate `sleep()` utility** — move from `poller.ts` and `state.ts` into `utils.ts`.

8. **Make `parseRateLimitResponse` resilient to partial failures** — skip invalid resources instead of returning `null` for the entire response.

### Lower Priority

9. **Update HANDOFF.md** — remove stale `mode=start`/`mode=stop` references, resolve `dist/` open question.

10. **Sync spec.json with implementation** — add `poller_started_at_ts` to `ReducerState`, add `PollLogEntry` and `PollLogBucketSnapshot` to boundary types.

11. **Add `poll-log.ts` tests** — basic tests for append, read, and missing file handling.

12. **Strengthen `isARealObject`** — add `!Array.isArray(value)` check, or add a dedicated `isValidBucketState` guard.

---

## What's Done Well

1. **Spec-first development** — `spec.json` provides a machine-readable contract. Rare and valuable.
2. **Pure reducer design** — entirely pure, deterministic, 100% tested. Gold standard for business logic.
3. **Result discriminated unions** — no thrown exceptions for expected failure paths. Every I/O operation returns a typed result.
4. **Adaptive polling algorithm** — `computeSleepPlan` with burst mode and debounce, documented in ADR-002.
5. **Atomic state persistence** — write-to-temp then rename, with orphan cleanup on failure.
6. **Defensive parsing** — GitHub API response validated field-by-field, not just type-cast.
7. **Pre-commit hooks and CI** — lint, format check, test, build, and dist-verification across Node 20/22/24.
8. **Incident documentation** — `INCIDENT-2026-01-28-self-test.md`, `POST_MORTEM.md`, `RETRO.md` show operational discipline.
9. **Declarative self-test generator** — scenario-based, adding tests is a data-only change.
10. **Safety mechanisms** — max lifetime guard (6h), SIGKILL escalation, orphan cleanup, token masking, platform assertion.

---

**Overall verdict:** Strong codebase with mature engineering practices. Core logic is excellent. Main gaps are user-facing documentation (README), test coverage on process lifecycle code, and a few small bugs/inconsistencies identified above.
