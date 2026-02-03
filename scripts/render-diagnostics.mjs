/**
 * render-diagnostics.mjs
 *
 * Standalone vanilla JS diagnostic renderer for self-test scenarios.
 * Reads state/poll data from either:
 *   - STATE_JSON + POLL_LOG_JSON (preferred for workflows), or
 *   - state.json + poll-log.json (or poll-log.jsonl) from $STATE_DIR (fallback)
 * Then outputs a <details><summary> markdown block to stdout for appending
 * to $GITHUB_STEP_SUMMARY.
 *
 * Usage:
 *   STATE_JSON='{}' POLL_LOG_JSON='[]' SCENARIO_NAME="core-5" node scripts/render-diagnostics.mjs
 *   STATE_DIR=/path/to/dir SCENARIO_NAME="core-5" node scripts/render-diagnostics.mjs
 *
 * No dependencies — uses only node:fs and node:path.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const scenarioName = process.env.SCENARIO_NAME || 'unknown';
const stateJsonEnv = process.env.STATE_JSON || '';
const pollLogJsonEnv = process.env.POLL_LOG_JSON || '';
const stateDir = process.env.STATE_DIR || '';

// ---------------------------------------------------------------------------
// Read inputs
// ---------------------------------------------------------------------------

let state = null;
const hasStateJson = stateJsonEnv.trim().length > 0;
const hasStateDir = stateDir.trim().length > 0;

if (!hasStateJson && !hasStateDir) {
  console.error('No STATE_JSON or STATE_DIR provided; skipping diagnostics.');
  process.exit(0);
}

if (hasStateJson) {
  try {
    state = JSON.parse(stateJsonEnv);
  } catch (error) {
    console.error('STATE_JSON is not valid JSON; skipping diagnostics.');
    process.exit(0);
  }
} else if (hasStateDir) {
  const statePath = join(stateDir, 'state.json');
  if (!existsSync(statePath)) {
    // No state file — nothing to render (graceful degradation)
    process.exit(0);
  }
  try {
    state = JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch (error) {
    console.error('state.json is not valid JSON; skipping diagnostics.');
    process.exit(0);
  }
}

if (!state || typeof state !== 'object' || !state.buckets) {
  console.error('state is missing buckets; skipping diagnostics.');
  process.exit(0);
}

/** @type {Array<{timestamp: string, poll_number: number, buckets: Record<string, {used: number, remaining: number, reset: number, limit: number, delta: number, window_crossed: boolean, anomaly: boolean}>}>} */
let pollLog = [];
const hasPollLogJson = pollLogJsonEnv.trim().length > 0;
if (hasPollLogJson) {
  try {
    const parsed = JSON.parse(pollLogJsonEnv);
    pollLog = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('POLL_LOG_JSON is not valid JSON; continuing without poll log.');
    pollLog = [];
  }
} else if (hasStateDir) {
  const pollLogJsonPath = join(stateDir, 'poll-log.json');
  const pollLogPath = join(stateDir, 'poll-log.jsonl');
  if (existsSync(pollLogJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(pollLogJsonPath, 'utf-8'));
      pollLog = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('poll-log.json is not valid JSON; continuing without poll log.');
      pollLog = [];
    }
  } else if (existsSync(pollLogPath)) {
    const lines = readFileSync(pollLogPath, 'utf-8').split('\n').filter(Boolean);
    pollLog = lines.map((line) => JSON.parse(line));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO timestamp string to compact HH:MM:SS UTC display. */
function formatISOTime(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19) + ' UTC';
}

function formatResetEpoch(epoch) {
  return new Date(epoch * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

// ---------------------------------------------------------------------------
// Render bucket summary table
// ---------------------------------------------------------------------------

function renderBucketSummary(state) {
  const lines = [];
  lines.push('#### Bucket Summary');
  lines.push('');
  lines.push('| Bucket | Used (start) | Used (end) | Used in job | Remaining (start) | Remaining (end) | Windows crossed |');
  lines.push('|--------|------------:|----------:|-----------:|-----------------:|---------------:|:--------------:|');

  const bucketEntries = Object.entries(state.buckets)
    .filter(([, b]) => b.total_used > 0 || b.windows_crossed > 0)
    .sort((a, b) => b[1].total_used - a[1].total_used);

  if (bucketEntries.length === 0) {
    lines.push('| *(no active buckets)* | | | | | | |');
  }

  for (const [name, bucket] of bucketEntries) {
    const firstUsed = bucket.first_used ?? '?';
    const firstRemaining = bucket.first_remaining ?? '?';
    lines.push(
      `| ${name} | ${firstUsed} | ${bucket.last_used} | ${bucket.total_used} | ${firstRemaining} | ${bucket.remaining} | ${bucket.windows_crossed} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Render poll timeline
// ---------------------------------------------------------------------------

function renderPollTimeline(pollLog) {
  if (pollLog.length === 0) {
    return '*No poll log available.*\n';
  }

  const lines = [];
  lines.push('#### Poll Timeline');
  lines.push('');
  lines.push('| # | Time | Δt | Bucket | Used | Remaining | Delta | Event |');
  lines.push('|--:|------|---:|--------|-----:|----------:|------:|-------|');

  let prevTs = null;

  for (const entry of pollLog) {
    const time = formatISOTime(entry.timestamp);
    const ts = Date.parse(entry.timestamp);
    let dt = '-';
    if (!Number.isNaN(ts) && prevTs !== null) {
      dt = ((ts - prevTs) / 1000).toFixed(1) + 's';
    }

    const bucketEntries = Object.entries(entry.buckets).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    if (bucketEntries.length === 0) {
      lines.push(`| ${entry.poll_number} | ${time} | ${dt} | *(empty)* | | | | |`);
      prevTs = ts;
      continue;
    }

    let firstBucketInPoll = true;
    for (const [name, snap] of bucketEntries) {
      const event = [];
      if (entry.poll_number === 1) event.push('baseline');
      if (snap.window_crossed) event.push('**window crossed**');
      if (snap.anomaly) event.push('anomaly');
      if (snap.delta > 0 && !snap.window_crossed && entry.poll_number > 1) event.push(`+${snap.delta}`);

      const pollNum = firstBucketInPoll ? String(entry.poll_number) : '';
      const timeCol = firstBucketInPoll ? time : '';
      const dtCol = firstBucketInPoll ? dt : '';
      firstBucketInPoll = false;

      lines.push(
        `| ${pollNum} | ${timeCol} | ${dtCol} | ${name} | ${snap.used} | ${snap.remaining} | ${snap.delta} | ${event.join(', ') || '-'} |`
      );
    }

    prevTs = ts;
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Render window crossing details
// ---------------------------------------------------------------------------

function renderWindowCrossings(pollLog) {
  // Find all polls where a window crossing occurred
  const crossings = [];
  for (let i = 0; i < pollLog.length; i++) {
    const entry = pollLog[i];
    for (const [name, snap] of Object.entries(entry.buckets)) {
      if (snap.window_crossed) {
        // Find previous poll's values for this bucket
        let prevSnap = null;
        for (let j = i - 1; j >= 0; j--) {
          if (pollLog[j].buckets[name]) {
            prevSnap = pollLog[j].buckets[name];
            break;
          }
        }
        crossings.push({
          bucket: name,
          poll_number: entry.poll_number,
          timestamp: entry.timestamp,
          before: prevSnap,
          after: snap,
        });
      }
    }
  }

  if (crossings.length === 0) {
    return '';
  }

  const lines = [];
  lines.push('#### Window Crossings');
  lines.push('');

  for (const c of crossings) {
    lines.push(`**${c.bucket}** — detected at poll #${c.poll_number} (${formatISOTime(c.timestamp)})`);
    if (c.before) {
      lines.push(`- Before: used=${c.before.used}, remaining=${c.before.remaining}, reset=${formatResetEpoch(c.before.reset)}`);
    }
    lines.push(`- After: used=${c.after.used}, remaining=${c.after.remaining}, reset=${formatResetEpoch(c.after.reset)}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Render poll metadata
// ---------------------------------------------------------------------------

function renderMetadata(state) {
  const lines = [];
  lines.push('#### Monitor Metadata');
  lines.push('');
  lines.push(`- **Started:** ${state.started_at_ts || '?'}`);
  lines.push(`- **Stopped:** ${state.stopped_at_ts || '(still running)'}`);
  lines.push(`- **Polls:** ${state.poll_count} successful, ${state.poll_failures} failed`);
  if (state.last_error) {
    lines.push(`- **Last error:** ${state.last_error}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main output
// ---------------------------------------------------------------------------

const sections = [
  renderMetadata(state),
  renderBucketSummary(state),
  renderPollTimeline(pollLog),
  renderWindowCrossings(pollLog),
].filter(Boolean);

const body = sections.join('\n');

const output = [
  `<details>`,
  `<summary><strong>Diagnostic Details: ${scenarioName}</strong></summary>`,
  ``,
  body,
  `</details>`,
  ``,
].join('\n');

process.stdout.write(output);
