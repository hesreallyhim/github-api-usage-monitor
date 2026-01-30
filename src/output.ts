/**
 * Output Renderer
 * Layer: infra
 *
 * Provided ports:
 *   - output.render
 *
 * Generates summary for GitHub step summary and console.
 */

import * as fs from 'fs';
import type { SummaryData, ReducerState, BucketState, PollLogEntry } from './types';

// -----------------------------------------------------------------------------
// Port: output.render
// -----------------------------------------------------------------------------

export interface RenderResult {
  /** Markdown for step summary */
  markdown: string;
  /** Plain text for console */
  console: string;
}

/**
 * Renders the summary data to markdown and console formats.
 *
 * @param data - Summary data to render
 */
export function render(data: SummaryData): RenderResult {
  const markdown = renderMarkdown(data);
  const consoleText = renderConsole(data);
  return { markdown, console: consoleText };
}

// -----------------------------------------------------------------------------
// Markdown rendering
// -----------------------------------------------------------------------------

/**
 * Renders full markdown summary for $GITHUB_STEP_SUMMARY.
 */
export function renderMarkdown(data: SummaryData): string {
  const { state, duration_seconds, warnings } = data;

  const lines: string[] = [];

  // Header
  lines.push('## GitHub API Usage (Monitor) — Job Summary');
  lines.push('');

  // Duration and poll info
  const duration = formatDuration(duration_seconds);
  lines.push(
    `**Duration:** ${duration} | **Polls:** ${state.poll_count} | **Failures:** ${state.poll_failures}`,
  );
  lines.push('');

  // Bucket table — only show buckets with actual usage
  const activeBuckets = getActiveBuckets(state);
  if (activeBuckets.length > 0) {
    lines.push('| Bucket | Used (job) | Windows | Remaining | Resets at (UTC) |');
    lines.push('|--------|----------:|--------:|----------:|-----------------|');

    for (const [name, bucket] of activeBuckets) {
      const resetTime = formatResetTime(bucket.last_reset);
      lines.push(
        `| ${name} | ${bucket.total_used} | ${bucket.windows_crossed} | ${bucket.remaining} | ${resetTime} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('*No API usage detected during this job.*');
    lines.push('');
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push('### Warnings');
    lines.push('');
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Console rendering
// -----------------------------------------------------------------------------

/**
 * Renders concise console output.
 */
export function renderConsole(data: SummaryData): string {
  const { state, duration_seconds, warnings } = data;

  const lines: string[] = [];

  // One-line summary
  const duration = formatDuration(duration_seconds);
  const totalUsed = Object.values(state.buckets).reduce((sum, b) => sum + b.total_used, 0);
  lines.push(`GitHub API Usage: ${totalUsed} requests in ${duration} (${state.poll_count} polls)`);

  // Top 3 buckets
  const buckets = getSortedBuckets(state).slice(0, 3);
  if (buckets.length > 0) {
    lines.push('Top buckets:');
    for (const [name, bucket] of buckets) {
      lines.push(`  - ${name}: ${bucket.total_used} used, ${bucket.remaining} remaining`);
    }
  }

  // Warnings (abbreviated)
  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.length}`);
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Returns buckets sorted by total_used descending.
 */
function getSortedBuckets(state: ReducerState): [string, BucketState][] {
  return Object.entries(state.buckets).sort((a, b) => b[1].total_used - a[1].total_used);
}

/**
 * Returns only buckets with actual usage (total_used > 0), sorted by total_used descending.
 * Idle buckets (total_used = 0) are filtered out to keep the summary clean.
 */
function getActiveBuckets(state: ReducerState): [string, BucketState][] {
  return getSortedBuckets(state).filter(([, bucket]) => bucket.total_used > 0);
}

/**
 * Formats duration in human-readable form.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Formats reset epoch as UTC timestamp.
 */
function formatResetTime(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

// -----------------------------------------------------------------------------
// GitHub Step Summary
// -----------------------------------------------------------------------------

/**
 * Writes markdown to GitHub step summary.
 */
export function writeStepSummary(markdown: string): void {
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath) {
    fs.appendFileSync(summaryPath, markdown + '\n');
  }
}

// -----------------------------------------------------------------------------
// Diagnostic details (collapsible <details> block)
// -----------------------------------------------------------------------------

/**
 * Renders a detailed diagnostic `<details>` block for the step summary.
 * Includes bucket summary, poll timeline with quiet-poll gap rows, and
 * window crossing details.
 *
 * Intended to be called from post.ts after state is finalized (final poll
 * done, markStopped called) so the data is complete.
 */
export function renderDiagnostics(state: ReducerState, pollLog: PollLogEntry[]): string {
  const sections: string[] = [
    renderDiagMetadata(state),
    renderDiagBucketSummary(state),
    renderDiagTimeline(pollLog),
    renderDiagWindowCrossings(pollLog),
  ].filter(Boolean);

  const body = sections.join('\n');
  return [
    '<details>',
    '<summary><strong>Diagnostic Details</strong></summary>',
    '',
    body,
    '</details>',
    '',
  ].join('\n');
}

function formatISOTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 19) + ' UTC';
}

function renderDiagMetadata(state: ReducerState): string {
  const lines: string[] = [];
  lines.push('#### Monitor Metadata');
  lines.push('');
  lines.push(`- **Started:** ${state.started_at_ts}`);
  lines.push(`- **Stopped:** ${state.stopped_at_ts ?? '(still running)'}`);
  lines.push(`- **Polls:** ${state.poll_count} successful, ${state.poll_failures} failed`);
  if (state.last_error) {
    lines.push(`- **Last error:** ${state.last_error}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderDiagBucketSummary(state: ReducerState): string {
  const lines: string[] = [];
  lines.push('#### Bucket Summary');
  lines.push('');
  lines.push(
    '| Bucket | Used (start) | Used (end) | Used in job | Remaining (start) | Remaining (end) | Windows crossed |',
  );
  lines.push(
    '|--------|------------:|----------:|-----------:|-----------------:|---------------:|:--------------:|',
  );

  const entries = Object.entries(state.buckets)
    .filter(([, b]) => b.total_used > 0 || b.windows_crossed > 0)
    .sort((a, b) => b[1].total_used - a[1].total_used);

  if (entries.length === 0) {
    lines.push('| *(no active buckets)* | | | | | | |');
  }

  for (const [name, bucket] of entries) {
    const firstUsed = bucket.first_used ?? '?';
    const firstRemaining = bucket.first_remaining ?? '?';
    lines.push(
      `| ${name} | ${firstUsed} | ${bucket.last_used} | ${bucket.total_used} | ${firstRemaining} | ${bucket.remaining} | ${bucket.windows_crossed} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function renderDiagTimeline(pollLog: PollLogEntry[]): string {
  if (pollLog.length === 0) {
    return '*No poll log available.*\n';
  }

  const lines: string[] = [];
  lines.push('#### Poll Timeline');
  lines.push('');
  lines.push('| # | Time | Bucket | Used | Remaining | Delta | Event |');
  lines.push('|--:|------|--------|-----:|----------:|------:|-------|');

  let lastEmittedPoll = 0;

  for (const entry of pollLog) {
    const time = formatISOTime(entry.timestamp);
    const bucketEntries = Object.entries(entry.buckets);

    if (bucketEntries.length === 0) {
      emitGapRow(lines, lastEmittedPoll, entry.poll_number);
      lines.push(`| ${entry.poll_number} | ${time} | *(empty)* | | | | |`);
      lastEmittedPoll = entry.poll_number;
      continue;
    }

    const hasInteresting = bucketEntries.some(
      ([, snap]) =>
        entry.poll_number === 1 || snap.delta > 0 || snap.window_crossed || snap.anomaly,
    );

    if (!hasInteresting) continue;

    emitGapRow(lines, lastEmittedPoll, entry.poll_number);

    let firstBucketInPoll = true;
    for (const [name, snap] of bucketEntries) {
      const isInteresting =
        entry.poll_number === 1 || snap.delta > 0 || snap.window_crossed || snap.anomaly;

      if (!isInteresting) continue;

      const event: string[] = [];
      if (entry.poll_number === 1) event.push('baseline');
      if (snap.window_crossed) event.push('**window crossed**');
      if (snap.anomaly) event.push('anomaly');
      if (snap.delta > 0 && !snap.window_crossed && entry.poll_number > 1)
        event.push(`+${snap.delta}`);

      const pollNum = firstBucketInPoll ? String(entry.poll_number) : '';
      const timeCol = firstBucketInPoll ? time : '';
      firstBucketInPoll = false;

      lines.push(
        `| ${pollNum} | ${timeCol} | ${name} | ${snap.used} | ${snap.remaining} | ${snap.delta} | ${event.join(', ') || '-'} |`,
      );
    }

    lastEmittedPoll = entry.poll_number;
  }

  // Trailing quiet-poll gap
  if (pollLog.length > 0) {
    const lastPoll = pollLog[pollLog.length - 1]!.poll_number;
    if (lastPoll > lastEmittedPoll) {
      const gapStart = lastEmittedPoll + 1;
      const count = lastPoll - gapStart + 1;
      const range = gapStart === lastPoll ? String(gapStart) : `${gapStart}\u2013${lastPoll}`;
      lines.push(
        `| ${range} | | *(no activity \u2014 ${count} poll${count > 1 ? 's' : ''})* | | | | |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** Insert a quiet-poll gap summary row if there's a gap before currentPoll. */
function emitGapRow(lines: string[], lastEmittedPoll: number, currentPoll: number): void {
  if (currentPoll - lastEmittedPoll <= 1) return;
  const gapStart = lastEmittedPoll + 1;
  const gapEnd = currentPoll - 1;
  if (gapStart > gapEnd) return;
  const count = gapEnd - gapStart + 1;
  const range = gapStart === gapEnd ? String(gapStart) : `${gapStart}\u2013${gapEnd}`;
  lines.push(
    `| ${range} | | *(no activity \u2014 ${count} poll${count > 1 ? 's' : ''})* | | | | |`,
  );
}

function renderDiagWindowCrossings(pollLog: PollLogEntry[]): string {
  const crossings: {
    bucket: string;
    poll_number: number;
    timestamp: string;
    before: PollLogEntry['buckets'][string] | null;
    after: PollLogEntry['buckets'][string];
  }[] = [];

  for (let i = 0; i < pollLog.length; i++) {
    const entry = pollLog[i]!;
    for (const [name, snap] of Object.entries(entry.buckets)) {
      if (snap.window_crossed) {
        let prevSnap: PollLogEntry['buckets'][string] | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const prev = pollLog[j]!.buckets[name];
          if (prev) {
            prevSnap = prev;
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

  if (crossings.length === 0) return '';

  const lines: string[] = [];
  lines.push('#### Window Crossings');
  lines.push('');

  for (const c of crossings) {
    lines.push(
      `**${c.bucket}** \u2014 detected at poll #${c.poll_number} (${formatISOTime(c.timestamp)})`,
    );
    if (c.before) {
      lines.push(
        `- Before: used=${c.before.used}, remaining=${c.before.remaining}, reset=${formatResetTime(c.before.reset)}`,
      );
    }
    lines.push(
      `- After: used=${c.after.used}, remaining=${c.after.remaining}, reset=${formatResetTime(c.after.reset)}`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Warning generation
// -----------------------------------------------------------------------------

/**
 * Generates warnings based on state analysis.
 */
export function generateWarnings(state: ReducerState): string[] {
  const warnings: string[] = [];

  // Poll failures
  if (state.poll_failures > 0) {
    warnings.push(`${state.poll_failures} poll(s) failed during monitoring`);
  }

  // Anomalies
  const totalAnomalies = Object.values(state.buckets).reduce((sum, b) => sum + b.anomalies, 0);
  if (totalAnomalies > 0) {
    warnings.push(`${totalAnomalies} anomaly(ies) detected (used decreased without reset)`);
  }

  // Multiple window crosses (only for active buckets — idle buckets rotate windows harmlessly)
  for (const [name, bucket] of Object.entries(state.buckets)) {
    if (bucket.windows_crossed > 1 && bucket.total_used > 0) {
      warnings.push(
        `${name} window crossed ${bucket.windows_crossed} times; totals are interval-bounded`,
      );
    }
  }

  // Last error
  if (state.last_error) {
    warnings.push(`Last error: ${state.last_error}`);
  }

  return warnings;
}
