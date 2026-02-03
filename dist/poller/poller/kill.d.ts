/**
 * Poller Process Lifecycle (Kill)
 *
 * Functions for stopping the poller process: SIGTERM, verification, SIGKILL escalation.
 * Extracted from poller.ts for testability.
 */
export interface KillResult {
    success: true;
    /** True if SIGKILL was needed after SIGTERM timeout */
    escalated?: boolean;
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
 * Kills poller with verification and SIGKILL escalation.
 * Sends SIGTERM, waits for exit, escalates to SIGKILL if needed.
 */
export declare function killPollerWithVerification(pid: number): Promise<KillOutcome>;
/**
 * Checks whether a process with the given PID is currently running.
 */
export declare function isProcessRunning(pid: number): boolean;
