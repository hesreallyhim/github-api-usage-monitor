/**
 * Main Entry
 * Layer: action
 *
 * GitHub Action entry point dispatching start/stop modes.
 *
 * Required ports:
 *   - poller.spawn
 *   - poller.kill
 *   - state.read
 *   - output.render
 */

import * as core from '@actions/core';
import type { ActionMode, SummaryData } from './types';
import { assertSupported, isSupported } from './platform';
import { spawnPoller, killPoller } from './poller';
import { readState, writeState, writePid, readPid, removePid } from './state';
import { createInitialState, markStopped } from './reducer';
import { render, writeStepSummary, generateWarnings } from './output';

// -----------------------------------------------------------------------------
// Action entry point
// -----------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    const mode = core.getInput('mode', { required: true }) as ActionMode;
    const token = core.getInput('token') || process.env['GITHUB_TOKEN'];

    if (!token) {
      throw new Error('No token provided. Set the token input or GITHUB_TOKEN environment variable.');
    }

    // Mask token to prevent accidental exposure
    core.setSecret(token);

    switch (mode) {
      case 'start':
        await handleStart(token);
        break;
      case 'stop':
        await handleStop();
        break;
      default:
        throw new Error(`Invalid mode: ${mode}. Must be 'start' or 'stop'.`);
    }
  } catch (error) {
    const err = error as Error;
    core.setFailed(err.message);
  }
}

// -----------------------------------------------------------------------------
// Start mode
// -----------------------------------------------------------------------------

async function handleStart(token: string): Promise<void> {
  core.info('Starting GitHub API usage monitor...');

  // Validate platform
  assertSupported();

  // Create initial state
  const state = createInitialState();
  const writeResult = writeState(state);
  if (!writeResult.success) {
    throw new Error(`Failed to write initial state: ${writeResult.error}`);
  }

  // Spawn poller
  const spawnResult = spawnPoller(token);
  if (!spawnResult.success) {
    throw new Error(`Failed to spawn poller: ${spawnResult.error}`);
  }

  // Save PID
  const pidResult = writePid(spawnResult.pid);
  if (!pidResult.success) {
    throw new Error(`Failed to write PID: ${pidResult.error}`);
  }

  core.info(`Monitor started (PID: ${spawnResult.pid})`);
}

// -----------------------------------------------------------------------------
// Stop mode
// -----------------------------------------------------------------------------

async function handleStop(): Promise<void> {
  core.info('Stopping GitHub API usage monitor...');

  const warnings: string[] = [];

  // Check platform (warn but continue)
  const platformInfo = isSupported();
  if (!platformInfo.supported) {
    warnings.push(`Unsupported platform: ${platformInfo.reason}`);
  }

  // Read PID and kill poller
  const pid = readPid();
  if (pid) {
    const killResult = killPoller(pid);
    if (!killResult.success && !killResult.notFound) {
      warnings.push(`Failed to kill poller: ${killResult.error}`);
    } else if (killResult.notFound) {
      warnings.push('Poller process not found (may have exited)');
    }
    removePid();
  } else {
    warnings.push('No PID file found (monitor may not have started)');
  }

  // Read final state
  const stateResult = readState();
  if (!stateResult.success) {
    if (stateResult.notFound) {
      core.warning('No state file found. Monitor may not have started or state was lost.');
      return;
    }
    throw new Error(`Failed to read state: ${stateResult.error}`);
  }

  // Mark as stopped
  const finalState = markStopped(stateResult.state);
  writeState(finalState);

  // Calculate duration
  const startTime = new Date(finalState.started_at_ts).getTime();
  const endTime = finalState.stopped_at_ts
    ? new Date(finalState.stopped_at_ts).getTime()
    : Date.now();
  const durationSeconds = Math.floor((endTime - startTime) / 1000);

  // Generate state-based warnings
  const stateWarnings = generateWarnings(finalState);
  warnings.push(...stateWarnings);

  // Render output
  const summaryData: SummaryData = {
    state: finalState,
    duration_seconds: durationSeconds,
    warnings,
  };

  const { markdown, console: consoleText } = render(summaryData);

  // Output
  core.info(consoleText);
  writeStepSummary(markdown);

  core.info('Monitor stopped');
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

run();
