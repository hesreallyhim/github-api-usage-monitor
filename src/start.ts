/**
 * Start handler
 * Layer: action
 *
 * Shared startup logic used by pre hook.
 */

import * as core from '@actions/core';
import { assertSupported } from './platform';
import { spawnPoller, killPoller } from './poller';
import { writeState, writePid, verifyPollerStartup } from './state';
import { createInitialState, reduce } from './reducer';
import { fetchRateLimit } from './github';

export async function startMonitor(token: string, diagnosticsEnabled: boolean): Promise<void> {
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
  const spawnResult = spawnPoller(token, diagnosticsEnabled);
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

  // Verify poller actually started - if this fails, kill and cleanup
  core.info('Verifying poller startup...');
  const verifyResult = await verifyPollerStartup();
  if (!verifyResult.success) {
    // Cleanup potentially dead/stuck process
    try {
      killPoller(spawnResult.pid);
    } catch {
      // Best effort cleanup
    }
    throw new Error(`Poller startup verification failed: ${verifyResult.error}`);
  }

  const bucketCount = Object.keys(state.buckets).length;
  core.info(`Monitor started (PID: ${spawnResult.pid}, tracking ${bucketCount} buckets)`);
}
