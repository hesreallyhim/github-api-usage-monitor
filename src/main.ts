/**
 * Main Entry
 * Layer: action
 *
 * GitHub Action main entry point. Spawns the background poller.
 * Cleanup and reporting is handled by post.ts (via action.yml post entry).
 *
 * Required ports:
 *   - poller.spawn
 *   - state.write
 *   - github.fetchRateLimit
 */

import * as core from '@actions/core';
import { assertSupported } from './platform';
import { spawnPoller, killPoller } from './poller';
import { writeState, writePid } from './state';
import { createInitialState, reduce } from './reducer';
import { fetchRateLimit } from './github';

// -----------------------------------------------------------------------------
// Action entry point
// -----------------------------------------------------------------------------

async function run(): Promise<void> {
  try {
    const token = core.getInput('token') || process.env['GITHUB_TOKEN'];

    if (!token) {
      throw new Error('No token provided. Set the token input or GITHUB_TOKEN environment variable.');
    }

    // Mask token to prevent accidental exposure
    core.setSecret(token);

    await handleStart(token);
  } catch (error) {
    const err = error as Error;
    core.setFailed(err.message);
  }
}

// -----------------------------------------------------------------------------
// Start handler
// -----------------------------------------------------------------------------

async function handleStart(token: string): Promise<void> {
  core.info('Starting GitHub API usage monitor...');

  // Validate platform
  assertSupported();

  // Initial poll to validate token and establish baseline (fail-fast)
  core.info('Validating token with initial API call...');
  const initialPoll = await fetchRateLimit(token);
  if (!initialPoll.success) {
    throw new Error(`Token validation failed: ${initialPoll.error}`);
  }

  // Create initial state with baseline from first poll
  let state = createInitialState();
  const reduceResult = reduce(state, initialPoll.data, initialPoll.timestamp);
  state = reduceResult.state;

  const writeResult = writeState(state);
  if (!writeResult.success) {
    throw new Error(`Failed to write initial state: ${writeResult.error}`);
  }

  // Spawn poller
  const spawnResult = spawnPoller(token);
  if (!spawnResult.success) {
    throw new Error(`Failed to spawn poller: ${spawnResult.error}`);
  }

  // Save PID - if this fails, kill the orphan process
  const pidResult = writePid(spawnResult.pid);
  if (!pidResult.success) {
    // Cleanup orphan process before failing
    try {
      killPoller(spawnResult.pid);
    } catch {
      // Best effort cleanup
    }
    throw new Error(`Failed to write PID: ${pidResult.error}`);
  }

  const bucketCount = Object.keys(state.buckets).length;
  core.info(`Monitor started (PID: ${spawnResult.pid}, tracking ${bucketCount} buckets)`);
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

void run();
