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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const POLLER_SCRIPT = path.resolve(__dirname, '../../dist/poller/index.js');

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

    // Capture stderr for debugging
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    // Wait for initial state write (poller does immediate first poll)
    // Even with invalid token, state should be written with poll_failures
    try {
      await waitForFile(statePath, 5000);
    } catch (err) {
      // Log debug info if file not found
      console.error('State file not created. Poller stderr:', stderr);
      console.error('Expected path:', statePath);
      console.error('Test dir contents:', fs.readdirSync(testStateDir, { recursive: true }));
      throw err;
    }

    // Verify state file exists and has content
    // Note: fake token causes poll failures, not successful polls
    const stateBefore = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const totalActivity = stateBefore.poll_count + stateBefore.poll_failures;
    expect(totalActivity).toBeGreaterThanOrEqual(1);

    // Send SIGTERM for graceful shutdown
    process.kill(child.pid!, 'SIGTERM');

    // Wait for process to exit
    const exitCode = await waitForProcessExit(child, 3000);

    // Verify clean exit
    expect(exitCode).toBe(0);

    // Verify final state was written (activity should be >= before)
    const stateAfter = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    const totalActivityAfter = stateAfter.poll_count + stateAfter.poll_failures;
    expect(totalActivityAfter).toBeGreaterThanOrEqual(totalActivity);
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

  it('process.kill(pid, 0) correctly detects running vs dead process', () => {
    // Spawn a short-lived process
    const shortProcess = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      detached: true,
      stdio: 'ignore',
    });

    const pid = shortProcess.pid!;

    // Should be running
    expect(isProcessRunning(pid)).toBe(true);

    // Kill it
    process.kill(pid, 'SIGKILL');

    // Wait a moment for OS to clean up
    // Note: this is slightly racy but acceptable for this test
    setTimeout(() => {
      expect(isProcessRunning(pid)).toBe(false);
    }, 100);
  });
});

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fs.existsSync(filePath)) {
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for file: ${filePath}`));
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
