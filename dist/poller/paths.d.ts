/**
 * Path Resolver
 * Layer: infra
 *
 * Provided ports:
 *   - paths.statePath
 *   - paths.pidPath
 *
 * Resolves paths within $RUNNER_TEMP for state persistence.
 */
/**
 * Returns the absolute path to the state directory.
 * Creates the path string only; does not create the directory.
 *
 * @throws Error if RUNNER_TEMP is not set
 */
export declare function getStateDir(): string;
/**
 * Returns the absolute path to state.json
 */
export declare function getStatePath(): string;
/**
 * Returns the absolute path to poller.pid
 */
export declare function getPidPath(): string;
/**
 * Returns the path for atomic write temporary file
 */
export declare function getStateTmpPath(): string;
