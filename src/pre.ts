/**
 * Pre Entry
 * Layer: action
 *
 * GitHub Action pre entry point for startup.
 * Runs automatically at job start (via action.yml pre entry).
 */

import * as core from '@actions/core';
import { startMonitor } from './start';
import { parseBooleanFlag } from './utils';

function isDiagnosticsEnabled(): boolean {
  return parseBooleanFlag(core.getInput('diagnostics'));
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('token') || process.env['GITHUB_TOKEN'];
    const diagnosticsEnabled = isDiagnosticsEnabled();

    if (!token) {
      throw new Error(
        'No token provided. Set the token input or GITHUB_TOKEN environment variable.',
      );
    }

    // Mask token to prevent accidental exposure
    core.setSecret(token);

    await startMonitor(token, diagnosticsEnabled);
  } catch (error) {
    const err = error as Error;
    core.setFailed(err.message);
  }
}

void run();
