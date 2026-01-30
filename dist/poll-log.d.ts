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
import type { PollLogEntry } from './types';
/**
 * Appends a single poll log entry as a JSON line to the poll log file.
 * Creates the file if it does not exist.
 *
 * Best-effort: swallows write errors so the poller is never disrupted
 * by diagnostic logging failures.
 */
export declare function appendPollLogEntry(entry: PollLogEntry): void;
/**
 * Reads all poll log entries from the JSONL file.
 * Returns an empty array if the file does not exist or is unreadable.
 */
export declare function readPollLog(): PollLogEntry[];
