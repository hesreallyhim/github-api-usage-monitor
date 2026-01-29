/**
 * Post Entry
 * Layer: action
 *
 * GitHub Action post entry point for cleanup and reporting.
 * Runs automatically after job completes (via action.yml post-if: always()).
 *
 * Required ports:
 *   - poller.kill
 *   - state.read
 *   - output.render
 */

import * as core from '@actions/core';
import type { SummaryData } from './types';
import { isSupported } from './platform';
import { killPollerWithVerification } from './poller';
import { readState, writeState, readPid, removePid } from './state';
import { markStopped, reduce } from './reducer';
import { fetchRateLimit } from './github';
import { render, writeStepSummary, generateWarnings } from './output';

// -----------------------------------------------------------------------------
// Post entry point
// -----------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    await handlePost();
  } catch (error) {
    const err = error as Error;
    core.setFailed(err.message);
  }
}

// -----------------------------------------------------------------------------
// Post handler (cleanup and report)
// -----------------------------------------------------------------------------

async function handlePost(): Promise<void> {
  core.info('Stopping GitHub API usage monitor...');

  const warnings: string[] = [];
  const token = core.getInput('token') || process.env['GITHUB_TOKEN'];
  if (token) {
    core.setSecret(token);
  }

  // Check platform (warn but continue)
  const platformInfo = isSupported();
  if (!platformInfo.supported) {
    warnings.push(`Unsupported platform: ${platformInfo.reason}`);
  }

  // Read PID and kill poller with verification
  const pid = readPid();
  if (pid) {
    const killResult = await killPollerWithVerification(pid);
    if (!killResult.success) {
      if (killResult.notFound) {
        warnings.push('Poller process not found (may have exited)');
      } else {
        warnings.push(`Failed to kill poller: ${killResult.error}`);
      }
    } else if (killResult.escalated) {
      warnings.push('Poller required SIGKILL (did not respond to SIGTERM)');
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

  // Optional final poll to capture last usage before shutdown
  let finalState = stateResult.state;
  if (token) {
    core.info('Performing final API poll...');
    const finalPoll = await fetchRateLimit(token);
    if (finalPoll.success) {
      const reduceResult = reduce(finalState, finalPoll.data, finalPoll.timestamp);
      finalState = reduceResult.state;
    } else {
      warnings.push(`Final poll failed: ${finalPoll.error}`);
    }
  } else {
    warnings.push('No token available for final poll');
  }

  // Mark as stopped
  finalState = markStopped(finalState);
  writeState(finalState);

  // Calculate duration
  const startTime = new Date(finalState.started_at_ts).getTime();
  const endTime = finalState.stopped_at_ts
    ? new Date(finalState.stopped_at_ts).getTime()
    : Date.now();
  const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

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

void run();
