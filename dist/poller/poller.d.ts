/**
 * Poller Process
 * Layer: poller
 *
 * Provided ports:
 *   - poller.spawn
 *   - poller.kill
 *
 * Background process that polls /rate_limit and updates state.
 * Runs as a detached child process.
 *
 * When run directly (as child process entry):
 *   - Reads config from environment
 *   - Polls at interval
 *   - Updates state file atomically
 *   - Handles SIGTERM for graceful shutdown
 */
export interface SpawnResult {
    success: true;
    pid: number;
}
export interface SpawnError {
    success: false;
    error: string;
}
export type SpawnOutcome = SpawnResult | SpawnError;
/**
 * Spawns the poller as a detached background process.
 *
 * @param token - GitHub token for API calls
 * @returns PID of spawned process or error
 */
export declare function spawnPoller(token: string): SpawnOutcome;
export interface KillResult {
    success: true;
}
export interface KillError {
    success: false;
    error: string;
    /** True if process was not found (may have already exited) */
    notFound: boolean;
}
export type KillOutcome = KillResult | KillError;
/**
 * Kills the poller process by PID.
 * Sends SIGTERM for graceful shutdown.
 *
 * @param pid - Process ID to kill
 */
export declare function killPoller(pid: number): KillOutcome;
/**
 * Entry point when run as child process.
 * Exported for use by poller-entry.ts
 */
export declare function main(): Promise<void>;
