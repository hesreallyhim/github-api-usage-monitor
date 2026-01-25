/**
 * Integration tests for poller process lifecycle.
 *
 * These tests spawn real processes and send real signals to verify
 * that the orphan-prevention safeguards work correctly.
 *
 * Run with: npm run test:integration
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

const POLLER_SCRIPT = path.resolve(__dirname, '../../dist/poller/index.js');

// Safety net: track all spawned PIDs to kill on exit
const spawnedPids = new Set<number>();

afterAll(() => {
  // Kill any orphaned processes from failed tests
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already dead
    }
  }
  spawnedPids.clear();
});

describe('Poller Lifecycle Integration', () => {
  let testStateDir: string;
  let child: ChildProcess | null = null;

  beforeEach(() => {
    testStateDir = fs.mkdtempSync(path.join('/tmp', 'poller-integration-'));
  });

  afterEach(() => {
    // Aggressive cleanup - kill any spawned process
    if (child?.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // Already dead - expected
      }
      spawnedPids.delete(child.pid);
    }
    child = null;

    // Clean up test directory
    if (testStateDir) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
  });

  it('poller script exists after build', () => {
    expect(fs.existsSync(POLLER_SCRIPT)).toBe(true);
  });

  it('exits cleanly on SIGTERM and writes final state', async () => {
    const statePath = path.join(testStateDir, 'github-api-usage-monitor', 'state.json');

    // Spawn poller with test environment
    child = spawn(process.execPath, [POLLER_SCRIPT], {
      env: {
        ...process.env,
        RUNNER_TEMP: testStateDir,
        GITHUB_API_MONITOR_TOKEN: 'test-token-for-integration',
        GITHUB_API_MONITOR_INTERVAL: '1', // Fast polling for test
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.pid) spawnedPids.add(child.pid);

    // Capture stderr for debugging
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Wait for poller to signal startup via poller_started_at_ts
    // The poller writes this immediately on startup, before any API calls
    try {
      await waitForPollerStartup(statePath, 5000);
    } catch (err) {
      // Log debug info if startup not detected
      console.error('Poller startup not detected. Poller stderr:', stderr);
      console.error('Expected path:', statePath);
      console.error('Test dir contents:', fs.readdirSync(testStateDir, { recursive: true }));
      throw err;
    }

    // Verify state file has poller_started_at_ts set
    const stateBefore = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { poller_started_at_ts: string | null };
    expect(stateBefore.poller_started_at_ts).toBeTruthy();

    // Send SIGTERM for graceful shutdown
    process.kill(child.pid!, 'SIGTERM');

    // Wait for process to exit
    const exitCode = await waitForProcessExit(child, 3000);

    // Verify clean exit
    expect(exitCode).toBe(0);

    // Verify final state was written (poller_started_at_ts should still be set)
    const stateAfter = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { poller_started_at_ts: string | null };
    expect(stateAfter.poller_started_at_ts).toBeTruthy();
  });

  it('process is killable with SIGKILL if SIGTERM fails', async () => {
    // Create a script that ignores SIGTERM (simulates hung process)
    const hungScript = path.join(testStateDir, 'hung-process.js');
    fs.writeFileSync(hungScript, `
      process.on('SIGTERM', () => {
        // Intentionally ignore SIGTERM
      });
      setInterval(() => {}, 1000);
    `);

    child = spawn(process.execPath, [hungScript], { detached: true, stdio: 'ignore' });
    if (child.pid) spawnedPids.add(child.pid);
    await sleep(100);

    // Verify process is running
    expect(isProcessRunning(child.pid!)).toBe(true);

    // SIGTERM should not kill it
    process.kill(child.pid!, 'SIGTERM');
    await sleep(200);
    expect(isProcessRunning(child.pid!)).toBe(true);

    // SIGKILL should kill it
    process.kill(child.pid!, 'SIGKILL');
    await waitForProcessExit(child, 1000);

    expect(isProcessRunning(child.pid!)).toBe(false);
  });

  it('process.kill(pid, 0) correctly detects running vs dead process', async () => {
    // Spawn a short-lived process
    const shortProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      detached: true,
      stdio: 'ignore',
    });

    const pid = shortProcess.pid!;
    spawnedPids.add(pid);

    // Should be running
    expect(isProcessRunning(pid)).toBe(true);

    // Kill it
    process.kill(pid, 'SIGKILL');

    // Wait for OS to clean up
    await sleep(100);
    expect(isProcessRunning(pid)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function waitForPollerStartup(statePath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      try {
        if (fs.existsSync(statePath)) {
          const content = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { poller_started_at_ts: string | null };
          if (content.poller_started_at_ts) {
            resolve();
            return;
          }
        }
      } catch {
        // File may be partially written, retry
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for poller startup: ${statePath}`));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
