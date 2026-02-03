/**
 * Poller Process Spawning
 *
 * Spawns the poller as a detached background child process.
 * Extracted from poller.ts for testability.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { POLL_INTERVAL_SECONDS } from '../types';

// -----------------------------------------------------------------------------
// Port: poller.spawn
// -----------------------------------------------------------------------------

export interface SpawnResult {
  success: true;
  pid: number;
}

export interface SpawnError {
  success: false;
  error: string;
}

export type SpawnOutcome = SpawnResult | SpawnError;

/**
 * Spawns the poller as a detached background process.
 *
 * @param token - GitHub token for API calls
 * @param diagnosticsEnabled - Enable poll log diagnostics
 * @returns PID of spawned process or error
 */
export function spawnPoller(token: string, diagnosticsEnabled: boolean): SpawnOutcome {
  try {
    // Resolve path to bundled poller entry
    // ncc bundles to dist/poller/index.js
    const actionPath = process.env['GITHUB_ACTION_PATH'];
    const baseDir = actionPath
      ? path.resolve(actionPath, 'dist')
      : path.dirname(process.argv[1] ?? '');
    const pollerEntry = path.join(baseDir, 'poller', 'index.js');

    const child: ChildProcess = spawn(process.execPath, [pollerEntry], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        GITHUB_API_MONITOR_TOKEN: token,
        GITHUB_API_MONITOR_INTERVAL: String(POLL_INTERVAL_SECONDS),
        GITHUB_API_MONITOR_DIAGNOSTICS: diagnosticsEnabled ? 'true' : 'false',
      },
    });

    // Allow parent to exit without waiting
    child.unref();

    if (!child.pid) {
      return { success: false, error: 'Failed to get child PID' };
    }

    return { success: true, pid: child.pid };
  } catch (err) {
    const error = err as Error;
    return { success: false, error: `Failed to spawn poller: ${error.message}` };
  }
}
