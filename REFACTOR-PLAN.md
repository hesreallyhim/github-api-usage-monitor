# Poller Refactor Plan: Split `src/poller.ts` into Testable Modules

## Status: REFACTOR COMPLETE — TESTING NEXT

Refactor committed at `18cbef8` on branch `coverage-more`.
All 219 existing tests pass. All 4 ncc build targets verified.
Next: write new tests for newly-exposed functions (step 12).

## Problem

`src/poller.ts` is 459 lines with 5 responsibilities and 44% test coverage (lowest in project).
Two key functions (`performPoll`, `runPollerLoop`) are private and untestable.
A SIGTERM handler is an anonymous closure capturing mutable state.

## Target Structure

```
src/
  poller.ts              → barrel re-export (backward compat): export * from './poller/index'
  poller/
    spawn.ts             (~60 lines)  Process spawning
    kill.ts              (~110 lines) Process lifecycle
    sleep-plan.ts        (~100 lines) Pure adaptive sleep planning
    perform-poll.ts      (~60 lines)  Single poll orchestration
    loop.ts              (~80 lines)  Main loop + entry point
    index.ts             (~30 lines)  Barrel re-exports
```

## Module Details

### 1. `src/poller/sleep-plan.ts` (extract first — pure, zero risk)

Move from poller.ts:
- `SleepPlan` type (line 206-213)
- Constants: `BURST_THRESHOLD_S`, `PRE_RESET_BUFFER_S`, `POST_RESET_DELAY_S`, `MIN_SLEEP_MS` (lines 215-218)
- `POLL_DEBOUNCE_MS` constant (line 282)
- `computeSleepPlan` function (lines 230-266)
- `applyDebounce` function (lines 289-295)

Imports: `types.ts` (ReducerState)
Already well-tested (~95% coverage). No changes needed.

### 2. `src/poller/kill.ts` (extract second — low risk)

Move from poller.ts:
- `KillResult`, `KillError`, `KillOutcome` types (lines 96-109)
- `KILL_TIMEOUT_MS`, `KILL_CHECK_INTERVAL_MS` constants (lines 111-112)
- `isProcessRunning` function (lines 193-200) — **NOW EXPORTED** (was private)
- `killPoller` function (lines 120-144)
- `killPollerWithVerification` function (lines 150-191)

Imports: `utils.ts` (sleep)

### 3. `src/poller/spawn.ts` (extract third — self-contained)

Move from poller.ts:
- `SpawnResult`, `SpawnError`, `SpawnOutcome` types (lines 38-48)
- `spawnPoller` function (lines 57-90)

Imports: `child_process`, `path`, `types.ts` (POLL_INTERVAL_SECONDS)

### 4. `src/poller/perform-poll.ts` (extract fourth — key testability unlock)

Move from poller.ts:
- `performPoll` function (lines 388-432) — **NOW EXPORTED** (was private)

Extract new pure helper:
- `buildDiagnosticsEntry(reduceResult, rateLimitData, pollCount, timestamp): PollLogEntry`
  - Extracted from the inline diagnostics snapshot construction (lines 408-428)
  - **Pure function**, testable with zero mocks

Imports: `github.ts`, `reducer.ts`, `state.ts`, `poll-log.ts`, `types.ts`

### 5. `src/poller/loop.ts` (extract fifth — refactored for testability)

Move from poller.ts:
- `isDiagnosticsEnabled` function (lines 30-32) — **NOW EXPORTED**
- `main` function (lines 442-455)
- `runPollerLoop` function (lines 317-383) — **NOW EXPORTED** with DI

New extracted factory:
- `createShutdownHandler(getState, writeFn, exitFn): () => void` — **NEW**
  - Replaces anonymous SIGTERM closure
  - Pure factory, testable by calling returned function with mocks

New dependency injection interface:
```typescript
interface LoopDeps {
  registerSignal: typeof process.on;
  exit: typeof process.exit;
  now: typeof Date.now;
  performPoll: typeof performPoll;
}
```
- `runPollerLoop` accepts optional `deps` parameter with production defaults
- Production call site unchanged: `runPollerLoop(token, interval, diagnostics)`
- Tests inject mocks to control the loop

Imports: `perform-poll.ts`, `sleep-plan.ts`, `state.ts`, `reducer.ts`, `utils.ts`, `types.ts`

### 6. `src/poller/index.ts` — Barrel re-exports

```typescript
export { spawnPoller, type SpawnResult, type SpawnError, type SpawnOutcome } from './spawn';
export { killPoller, killPollerWithVerification, isProcessRunning, type KillResult, type KillError, type KillOutcome } from './kill';
export { computeSleepPlan, applyDebounce, POLL_DEBOUNCE_MS, type SleepPlan } from './sleep-plan';
export { performPoll, buildDiagnosticsEntry } from './perform-poll';
export { main, createShutdownHandler } from './loop';
```

### 7. `src/poller.ts` — Becomes barrel re-export

```typescript
export * from './poller/index';
```

All existing imports (`import { spawnPoller } from '../src/poller'`) continue to work.

## Consumers (no mandatory changes)

- `src/start.ts` imports `spawnPoller`, `killPoller` from `./poller` — works via barrel
- `src/post.ts` imports `killPollerWithVerification` from `./poller` — works via barrel
- `src/poller-entry.ts` imports `main` from `./poller` — works via barrel
- `test/poller.test.ts` imports from `../src/poller` — works via barrel

## Execution Order

1. Create `src/poller/` directory
2. Extract `sleep-plan.ts` (pure, zero risk, already tested)
3. Extract `kill.ts` (low risk, existing tests)
4. Extract `spawn.ts` (self-contained)
5. Extract `perform-poll.ts` with `buildDiagnosticsEntry` extraction
6. Extract `loop.ts` with `createShutdownHandler` factory and `LoopDeps` injection
7. Create `src/poller/index.ts` barrel
8. Convert `src/poller.ts` to barrel re-export
9. Run `npm test` — all existing tests must pass with zero modifications
10. Run `npm run build:all` — verify ncc bundling works
11. Commit the refactor
12. Write new tests for newly-exposed functions (separate commit)

## Coverage Estimates After Refactor + New Tests

| Module | Before | After |
|---|---|---|
| `sleep-plan.ts` | ~95% | ~95% |
| `kill.ts` | ~60% | ~90% |
| `spawn.ts` | ~40% | ~80% |
| `perform-poll.ts` | 0% | ~90% |
| `loop.ts` | ~5% | ~70% |
| **Overall poller/** | **44%** | **~85%** |

## Key Risks & Mitigations

1. **ncc bundling**: `src/poller.ts` barrel file is found first by ncc, follows through to sub-modules. No config change needed.
2. **poller-entry.ts**: Still imports `main` from `./poller` which resolves through barrel. No change needed.
3. **Existing tests**: Barrel re-export means zero test changes required for the refactor itself.
4. **DI complexity**: Production defaults in `LoopDeps` keep call sites unchanged. DI only visible to tests.
