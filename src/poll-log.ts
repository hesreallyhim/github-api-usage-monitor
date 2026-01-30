/**
 * Poll Log
 * Layer: infra
 *
 * Provided ports:
 *   - pollLog.append
 *
 * Append-only JSONL diagnostic log of per-poll snapshots.
 * Each line is a self-contained JSON object (PollLogEntry).
 * Used by self-test diagnostics for detailed debugging;
 * the main action summary (output.ts) does not read this file.
 */

import * as fs from 'fs';
import type { PollLogEntry } from './types';
import { getPollLogPath } from './paths';

// -----------------------------------------------------------------------------
// Port: pollLog.append
// -----------------------------------------------------------------------------

/**
 * Appends a single poll log entry as a JSON line to the poll log file.
 * Creates the file if it does not exist.
 *
 * Best-effort: swallows write errors so the poller is never disrupted
 * by diagnostic logging failures.
 */
export function appendPollLogEntry(entry: PollLogEntry): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getPollLogPath(), line, 'utf-8');
  } catch {
    // Diagnostic-only — never disrupt the poller
  }
}

// -----------------------------------------------------------------------------
// Port: pollLog.read
// -----------------------------------------------------------------------------

/**
 * Reads all poll log entries from the JSONL file.
 * Returns an empty array if the file does not exist or is unreadable.
 */
export function readPollLog(): PollLogEntry[] {
  try {
    const path = getPollLogPath();
    if (!fs.existsSync(path)) return [];
    const content = fs.readFileSync(path, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PollLogEntry);
  } catch {
    return [];
  }
}
