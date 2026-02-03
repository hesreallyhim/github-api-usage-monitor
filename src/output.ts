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
import type { SummaryData, ReducerState, BucketState } from './types';

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
