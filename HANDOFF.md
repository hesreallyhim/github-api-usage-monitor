# Handoff: Poller Refactor & Testing

## Branch: `coverage-more`

## Commit History (newest first)

| Commit | Description |
|---|---|
| `80dc945` | refactor(test): address testing-expert review feedback |
| `5826884` | test: add 25 tests for refactored poller modules (batches A-F) |
| `69ccfb1` | docs: add handoff notes and testing plan for poller refactor |
| `18cbef8` | refactor: split poller.ts into focused modules under src/poller/ |

## Phase 1: Refactor (COMPLETE)

The 459-line `src/poller.ts` was split into 5 focused modules under `src/poller/`:

| Module | Lines | Responsibility |
|---|---|---|
| `sleep-plan.ts` | ~100 | Pure adaptive sleep planning (when to poll next) |
| `kill.ts` | ~115 | Process lifecycle: SIGTERM, SIGKILL escalation, `isProcessRunning` |
| `spawn.ts` | ~70 | Detached child process spawning |
| `perform-poll.ts` | ~85 | Single poll cycle: fetch → reduce → write → diagnostics |
| `loop.ts` | ~160 | Main loop, entry point, shutdown handler, DI interface |

`src/poller.ts` is a 7-line barrel. `src/poller/index.ts` re-exports all public symbols.

### Key Testability Unlocks

1. **`performPoll`** — was private, now exported from `perform-poll.ts`
2. **`buildDiagnosticsEntry`** — NEW pure function; zero mocks needed
3. **`runPollerLoop`** — was private, now exported with `LoopDeps` DI interface
4. **`createShutdownHandler`** — NEW factory replacing anonymous SIGTERM closure
5. **`isProcessRunning`** — was private, now exported from `kill.ts`
6. **`isDiagnosticsEnabled`** — was private, now exported from `loop.ts`

### `LoopDeps` Interface

```typescript
interface LoopDeps {
  registerSignal: (event: string, handler: () => void) => void;
  exit: (code: number) => void;
  now: () => number;
  performPoll: typeof performPoll;
}
```

Production defaults are built-in; tests pass custom `deps` as the 4th argument.

### Source fix in loop.ts

Added `return` after `deps.exit(0)` in `runPollerLoop` (line 128) — defensive fix preventing continued execution if `process.exit` doesn't terminate. This also makes the loop testable without exception-based hacks.

---

## Phase 2: Batches A–F Tests (COMPLETE)

25 new tests added to `test/poller.test.ts`, reviewed and approved by testing-expert agent.

### Batches implemented

| Batch | Target | Tests | Mocking |
|---|---|---|---|
| A | `buildDiagnosticsEntry` | 5 tests | None (pure function) |
| B | `createShutdownHandler` | 3 tests | `vi.fn()` for writeFn/exitFn |
| C | `isDiagnosticsEnabled` | 5 tests | `process.env` manipulation |
| D | `performPoll` | 4 tests | `vi.mock` for github, reducer, state, poll-log |
| E | `runPollerLoop` | 6 tests | `LoopDeps` DI + `makeTimedDeps` helper |
| F | `isProcessRunning` | 2 tests | None (real `process.kill(pid, 0)`) |

### Test infrastructure notes

- **`vi.mock` hoisting**: Mocks for `../src/utils`, `../src/github`, `../src/reducer`, `../src/state`, `../src/poll-log` are hoisted to file top and affect ALL describe blocks. Documented with comments in the test file. Harmless for pure-function tests.
- **`sleep` mock**: `sleep` from `../src/utils` resolves immediately for all tests. This is why `killPollerWithVerification` tests don't need fake timers.
- **`makeTimedDeps(exitAfterNowCalls, overrides?)`**: Helper that creates `LoopDeps` where `deps.now()` returns `MAX_LIFETIME_MS` after N calls, causing the loop to exit cleanly via the lifetime check + `return` statement.
- **`main` test**: Uses `rejects.toThrow` (not try/catch).

---

## Current Coverage (post-testing)

| Module | Stmts | Branch | Funcs | Lines | Uncovered |
|---|---|---|---|---|---|
| `sleep-plan.ts` | 95.8% | 90% | 100% | 95.8% | line 57 |
| `kill.ts` | 70.3% | 50% | 100% | 70.3% | 84, 97-109 |
| `loop.ts` | 83.3% | 60% | 55.5% | 85.1% | 58-63, 140-142, 171 |
| `perform-poll.ts` | 100% | 100% | 100% | 100% | — |
| `spawn.ts` | 0% | 0% | 0% | 0% | 36-66 |
| `index.ts` | 0% | 0% | 0% | 0% | (barrel, ignore) |
| **poller/ overall** | **77.7%** | **58.8%** | **75%** | **78.3%** | |
| **All files** | **90.9%** | **82.9%** | **91.3%** | **91.1%** | |

---

## Remaining Uncovered Paths (deferred follow-ups)

### kill.ts (lines 84, 97-109)
- **SIGTERM EPERM error** (line 84): `process.kill(pid, 'SIGTERM')` throws non-ESRCH error
- **SIGKILL escalation** (lines 97-109): Process survives SIGTERM timeout, SIGKILL sent
  - SIGKILL success → `{ success: true, escalated: true }`
  - Process survives SIGKILL → `{ success: false, error: 'Process survived SIGKILL' }`
  - ESRCH during SIGKILL → died between check and kill
- Requires complex multi-step mock choreography with timing control

### loop.ts (lines 58-63, 140-142, 171)
- **defaultDeps object** (lines 58-63): Only exercised in production, not via DI tests
- **Burst path in loop** (lines 140-142): When `plan.burst` is true, second poll occurs. Requires triggering `computeSleepPlan` burst mode from within the running loop
- **`main()` with valid token** (line 171): Would start an actual polling loop

### spawn.ts (lines 36-66)
- Intentionally deferred — `child_process.spawn` with detached processes requires heavyweight integration harnesses

---

## Test Count

244 total tests across 10 test files, all passing. Lint, format, and all 4 ncc builds verified.
