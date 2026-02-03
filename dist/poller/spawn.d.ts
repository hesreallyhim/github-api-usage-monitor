/**
 * Poller Process Spawning
 *
 * Spawns the poller as a detached background child process.
 * Extracted from poller.ts for testability.
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
 * @param diagnosticsEnabled - Enable poll log diagnostics
 * @returns PID of spawned process or error
 */
export declare function spawnPoller(token: string, diagnosticsEnabled: boolean): SpawnOutcome;
