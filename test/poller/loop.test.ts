/**
 * Tests for runPollerLoop, createShutdownHandler, isDiagnosticsEnabled, and main.
 *
 * Mocks: utils (sleep), state (readState, writeState).
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  main,
  createShutdownHandler,
  isDiagnosticsEnabled,
  runPollerLoop,
  createRateLimitControlState,
} from '../../src/poller';
import type { LoopDeps } from '../../src/poller';
import type { ReducerState } from '../../src/types';
import { MAX_LIFETIME_MS } from '../../src/types';
import { makeState, makeBucket } from './helpers';

// -----------------------------------------------------------------------------
// Module mocks
// -----------------------------------------------------------------------------

vi.mock('../../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils')>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/reducer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/reducer')>();
  return {
    ...actual,
    reduce: vi.fn(),
    recordFailure: vi.fn(),
  };
});

vi.mock('../../src/state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state')>();
  return {
    ...actual,
    writeState: vi.fn(),
    readState: vi.fn(),
  };
});

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

describe('main', () => {
  let exitSpy: MockInstance;
  let errorSpy: MockInstance;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach((): void => {
    savedEnv = { ...process.env };
    delete process.env['GITHUB_API_MONITOR_TOKEN'];

    // Mock process.exit to throw an error instead of exiting
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with code ${code}`);
    }) as never);

    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach((): void => {
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  it('exits with code 1 when GITHUB_API_MONITOR_TOKEN is not set', async (): Promise<void> => {
    await expect(main()).rejects.toThrow('process.exit called with code 1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('GITHUB_API_MONITOR_TOKEN not set');
  });
});

// -----------------------------------------------------------------------------
// createShutdownHandler
// -----------------------------------------------------------------------------

describe('createShutdownHandler', () => {
  it('calls writeFn with current state when state exists, then calls exitFn(0)', (): void => {
    const state = makeState();
    const writeFn = vi.fn();
    const exitFn = vi.fn();

    const handler = createShutdownHandler(() => state, writeFn, exitFn);
    handler();

    expect(writeFn).toHaveBeenCalledWith(state);
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('skips writeFn when getState returns undefined, still calls exitFn(0)', (): void => {
    const writeFn = vi.fn();
    const exitFn = vi.fn();

    const handler = createShutdownHandler(() => undefined, writeFn, exitFn);
    handler();

    expect(writeFn).not.toHaveBeenCalled();
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('calls getState exactly once per invocation', (): void => {
    const getState = vi.fn(() => undefined);
    const handler = createShutdownHandler(getState, vi.fn(), vi.fn());

    handler();
    expect(getState).toHaveBeenCalledTimes(1);

    handler();
    expect(getState).toHaveBeenCalledTimes(2);
  });
});

// -----------------------------------------------------------------------------
// isDiagnosticsEnabled
// -----------------------------------------------------------------------------

describe('isDiagnosticsEnabled', () => {
  let savedVal: string | undefined;

  beforeEach((): void => {
    savedVal = process.env['GITHUB_API_MONITOR_DIAGNOSTICS'];
  });

  afterEach((): void => {
    if (savedVal === undefined) {
      delete process.env['GITHUB_API_MONITOR_DIAGNOSTICS'];
    } else {
      process.env['GITHUB_API_MONITOR_DIAGNOSTICS'] = savedVal;
    }
  });

  it('returns true when env var is "true"', (): void => {
    process.env['GITHUB_API_MONITOR_DIAGNOSTICS'] = 'true';
    expect(isDiagnosticsEnabled()).toBe(true);
  });

  it('returns true when env var is "1"', (): void => {
    process.env['GITHUB_API_MONITOR_DIAGNOSTICS'] = '1';
    expect(isDiagnosticsEnabled()).toBe(true);
  });

  it('returns false when env var is "false"', (): void => {
    process.env['GITHUB_API_MONITOR_DIAGNOSTICS'] = 'false';
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('returns false when env var is undefined', (): void => {
    delete process.env['GITHUB_API_MONITOR_DIAGNOSTICS'];
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('returns false when env var is empty string', (): void => {
    process.env['GITHUB_API_MONITOR_DIAGNOSTICS'] = '';
    expect(isDiagnosticsEnabled()).toBe(false);
  });
});

// =============================================================================
// runPollerLoop (DI-based, control loop via deps)
// =============================================================================

describe('runPollerLoop', () => {
  let readState: ReturnType<typeof vi.fn>;
  let writeState: ReturnType<typeof vi.fn>;

  beforeEach(async (): Promise<void> => {
    const state = await import('../../src/state');
    readState = state.readState as ReturnType<typeof vi.fn>;
    writeState = state.writeState as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  function makeDeps(overrides: Partial<LoopDeps> = {}): LoopDeps {
    return {
      registerSignal: vi.fn(),
      exit: vi.fn(),
      now: vi.fn(() => 0),
      performPoll: vi.fn(),
      ...overrides,
    };
  }

  function makePollSuccess(state: ReducerState) {
    return { success: true as const, state, control_state: createRateLimitControlState() };
  }

  /** Creates deps that exit via MAX_LIFETIME_MS after `exitAfterNowCalls` calls to `deps.now`. */
  function makeTimedDeps(exitAfterNowCalls: number, overrides?: Partial<LoopDeps>): LoopDeps {
    let nowCallCount = 0;
    return makeDeps({
      now: vi.fn(() => {
        nowCallCount++;
        return nowCallCount >= exitAfterNowCalls ? MAX_LIFETIME_MS : 0;
      }),
      performPoll: vi.fn().mockResolvedValue(makePollSuccess(makeState())),
      ...overrides,
    });
  }

  it('reads or creates initial state and writes it with poller_started_at_ts', async (): Promise<void> => {
    const existingState = makeState();
    readState.mockReturnValue({ success: true, state: existingState });

    const deps = makeTimedDeps(2);

    await runPollerLoop('token', 30, false, deps);

    expect(writeState).toHaveBeenCalled();
    const firstWriteArg = writeState.mock.calls[0][0] as ReducerState;
    expect(firstWriteArg.poller_started_at_ts).toBeDefined();
  });

  it('calls performPoll immediately on startup', async (): Promise<void> => {
    readState.mockReturnValue({ success: false });

    const deps = makeTimedDeps(2);

    await runPollerLoop('token', 30, false, deps);

    expect(deps.performPoll).toHaveBeenCalled();
    expect((deps.performPoll as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('token');
  });

  it('exits loop when MAX_LIFETIME_MS exceeded', async (): Promise<void> => {
    readState.mockReturnValue({ success: false });

    const deps = makeTimedDeps(2);

    await runPollerLoop('token', 30, false, deps);

    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('registers SIGTERM handler via deps.registerSignal', async (): Promise<void> => {
    readState.mockReturnValue({ success: false });

    const deps = makeTimedDeps(2);

    await runPollerLoop('token', 30, false, deps);

    expect(deps.registerSignal).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('error in loop body: logs error, sleeps fallback interval, then retries', async (): Promise<void> => {
    readState.mockReturnValue({ success: false });

    let pollCallCount = 0;
    const deps = makeTimedDeps(3, {
      performPoll: vi.fn().mockImplementation(() => {
        pollCallCount++;
        if (pollCallCount === 1) return Promise.resolve(makePollSuccess(makeState()));
        return Promise.reject(new Error('network failure'));
      }),
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runPollerLoop('token', 30, false, deps);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('network failure'));

    // Verify the catch block called sleep with the fallback base interval
    const { sleep } = await import('../../src/utils');
    expect(sleep).toHaveBeenCalledWith(30 * 1000);

    errorSpy.mockRestore();
  });

  it('executes burst path when computeSleepPlan returns burst: true', async (): Promise<void> => {
    // Setup: bucket with reset 5 seconds in the future triggers burst mode.
    // computeSleepPlan returns burst:true when secondsUntilReset <= 8.
    // nowEpochSeconds = Math.floor(deps.now() / 1000).
    const resetEpoch = 1706200000;
    const nowMs = (resetEpoch - 5) * 1000; // 5s before reset

    const burstState = makeState({
      core: makeBucket({ last_reset: resetEpoch, total_used: 100 }),
    });

    readState.mockReturnValue({ success: false });

    // deps.now() call sequence in runPollerLoop:
    //   Call 1: startTimeMs = deps.now()          (line 94)
    //   Call 2: elapsedMs = deps.now() - start     (line 120, loop iter 1)
    //   Call 3: Math.floor(deps.now()/1000)         (line 134, computeSleepPlan)
    //   -- burst fires: sleep + performPoll (line 141-142)
    //   Call 4: elapsedMs = deps.now() - start     (line 120, loop iter 2) → exit
    let nowCallCount = 0;
    const deps = makeDeps({
      now: vi.fn(() => {
        nowCallCount++;
        if (nowCallCount <= 3) return nowMs;
        return nowMs + MAX_LIFETIME_MS; // triggers lifetime exit
      }),
      performPoll: vi.fn().mockResolvedValue(makePollSuccess(burstState)),
    });

    await runPollerLoop('token', 30, false, deps);

    // performPoll called: startup (line 114) + regular poll (line 138) + burst poll (line 142) = 3
    const pollCalls = (deps.performPoll as ReturnType<typeof vi.fn>).mock.calls;
    expect(pollCalls).toHaveLength(3);
  });

  it('creates initial state when readState fails', async (): Promise<void> => {
    readState.mockReturnValue({ success: false });

    const deps = makeTimedDeps(2);

    await runPollerLoop('token', 30, false, deps);

    const firstWriteArg = writeState.mock.calls[0][0] as ReducerState;
    expect(firstWriteArg.poller_started_at_ts).toBeDefined();
    expect(firstWriteArg.poll_count).toBe(0);
  });
});
