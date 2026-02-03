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
import { DefaultArtifactClient } from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import type { SummaryData } from './types';
import { isSupported } from './platform';
import { killPollerWithVerification } from './poller';
import { readState, writeState, readPid, removePid } from './state';
import { markStopped, reduce } from './reducer';
import { fetchRateLimit } from './github';
import { render, writeStepSummary, generateWarnings } from './output';
import { readPollLog } from './poll-log';
import { getStateDir, getStatePath, getPollLogPath } from './paths';
import { parseBooleanFlag } from './utils';

// -----------------------------------------------------------------------------
// Post artifact helpers
// -----------------------------------------------------------------------------

const ARTIFACT_PREFIX = 'github-api-usage-monitor';
const POLL_LOG_JSON_NAME = 'poll-log.json';

type ArtifactPayload = {
  stateJson: string;
  pollLogJson: string;
};

type UploadOutcome =
  | { success: true; name: string; files: string[] }
  | { success: false; name: string; error: string };

function isDiagnosticsEnabled(): boolean {
  return parseBooleanFlag(core.getInput('diagnostics'));
}

function getArtifactName(): string {
  const custom = core.getInput('artifact_name');
  if (custom) return custom;
  const jobId = process.env['GITHUB_JOB'] ?? 'job';
  return `${ARTIFACT_PREFIX}-${jobId}`;
}

async function uploadDiagnosticsArtifact(payload: ArtifactPayload): Promise<UploadOutcome> {
  const artifactName = getArtifactName();

  try {
    const stateDir = getStateDir();
    fs.mkdirSync(stateDir, { recursive: true });

    const statePath = getStatePath();
    if (!fs.existsSync(statePath)) {
      fs.writeFileSync(statePath, payload.stateJson, 'utf-8');
    }

    const pollLogJsonPath = path.join(stateDir, POLL_LOG_JSON_NAME);
    fs.writeFileSync(pollLogJsonPath, payload.pollLogJson, 'utf-8');

    const files: string[] = [];
    if (fs.existsSync(statePath)) {
      files.push(statePath);
    }
    if (fs.existsSync(pollLogJsonPath)) {
      files.push(pollLogJsonPath);
    }

    if (files.length === 0) {
      return {
        success: false,
        name: artifactName,
        error: 'No diagnostic files available for upload',
      };
    }

    const artifactClient = new DefaultArtifactClient();
    const cwd = process.cwd();
    try {
      process.chdir(stateDir);
      const relativeFiles = files.map((file) => path.relative(stateDir, file));
      await artifactClient.uploadArtifact(artifactName, relativeFiles, stateDir);
    } finally {
      process.chdir(cwd);
    }

    return { success: true, name: artifactName, files };
  } catch (error) {
    const err = error as Error;
    return { success: false, name: artifactName, error: err.message };
  }
}

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
  const diagnosticsEnabled = isDiagnosticsEnabled();
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
  const statePath = getStatePath();
  core.info(`State path: ${statePath}`);
  if (diagnosticsEnabled) {
    const pollLogPath = getPollLogPath();
    core.info(`Poll log path: ${pollLogPath}`);
  } else {
    core.info('Diagnostics disabled; skipping poll log and artifact upload.');
  }

  const stateResult = readState();
  if (!stateResult.success) {
    if (stateResult.notFound) {
      core.warning('No state file found. Monitor may not have started or state was lost.');
      if (diagnosticsEnabled) {
        const pollLog = readPollLog();
        const emptyState = {};
        const stateJson = JSON.stringify(emptyState);
        const pollLogJson = JSON.stringify(pollLog);

        const uploadResult = await uploadDiagnosticsArtifact({ stateJson, pollLogJson });
        if (uploadResult.success) {
          core.info(
            `Diagnostics artifact uploaded (missing state): ${uploadResult.name} ` +
              `(${uploadResult.files.length} files)`,
          );
        } else {
          core.warning(`Diagnostics artifact upload failed: ${uploadResult.error}`);
        }
      }
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

  // Debug: dump per-bucket state (visible only with ACTIONS_STEP_DEBUG=true)
  core.debug('--- per-bucket state ---');
  core.debug(`Poll count: ${finalState.poll_count} | Failures: ${finalState.poll_failures}`);
  core.debug(`Started: ${finalState.started_at_ts} | Stopped: ${finalState.stopped_at_ts}`);
  for (const [name, bucket] of Object.entries(finalState.buckets)) {
    core.debug(
      `  ${name}: first_used=${bucket.first_used}, last_used=${bucket.last_used}, ` +
        `total_used=${bucket.total_used}, windows_crossed=${bucket.windows_crossed}, ` +
        `last_reset=${bucket.last_reset}, remaining=${bucket.remaining}, limit=${bucket.limit}`,
    );
  }
  core.debug('--- End per-bucket state ---');

  // Calculate duration
  const startTime = new Date(finalState.started_at_ts).getTime();
  const endTime = finalState.stopped_at_ts
    ? new Date(finalState.stopped_at_ts).getTime()
    : Date.now();
  const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));

  // Generate state-based warnings
  const stateWarnings = generateWarnings(finalState);
  warnings.push(...stateWarnings);

  if (diagnosticsEnabled) {
    const pollLog = readPollLog();
    const stateJson = JSON.stringify(finalState);
    const pollLogJson = JSON.stringify(pollLog);

    const uploadResult = await uploadDiagnosticsArtifact({ stateJson, pollLogJson });
    if (uploadResult.success) {
      core.info(
        `Diagnostics artifact uploaded: ${uploadResult.name} (${uploadResult.files.length} files)`,
      );
    } else {
      warnings.push(`Diagnostics artifact upload failed: ${uploadResult.error}`);
      core.warning(`Diagnostics artifact upload failed: ${uploadResult.error}`);
    }
  }

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

// void run();
await run();
