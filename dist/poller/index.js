import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

;// CONCATENATED MODULE: external "child_process"
const external_child_process_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("child_process");
;// CONCATENATED MODULE: external "path"
const external_path_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("path");
;// CONCATENATED MODULE: ./src/types.ts
/**
 * Boundary types for github-api-usage-monitor v1
 * Generated from spec/spec.json
 *
 * These types define the contracts between modules.
 * Do not modify without updating the spec.
 */
// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const types_POLL_INTERVAL_SECONDS = 30;
const STATE_DIR_NAME = 'github-api-usage-monitor';
const STATE_FILE_NAME = 'state.json';
const types_PID_FILE_NAME = 'poller.pid';
/** Timeout for fetch requests to GitHub API (milliseconds) */
const FETCH_TIMEOUT_MS = 10000;
/** Maximum poller lifetime as defense-in-depth (6 hours in milliseconds) */
const MAX_LIFETIME_MS = 6 * 60 * 60 * 1000;

;// CONCATENATED MODULE: ./src/utils.ts
/**
 * Checks if input is an object and not null.
 */
const isARealObject = (value) => {
    return typeof value === 'object' && value !== null;
};
/**
 * Checks if input is a string or null.
 * Used for validating optional string fields in state.
 */
const isStringOrNull = (value) => {
    return value === null || typeof value === 'string';
};

;// CONCATENATED MODULE: ./src/github.ts
/**
 * GitHub API Client
 * Layer: infra
 *
 * Provided ports:
 *   - github.fetchRateLimit
 *
 * Fetches rate limit data from the GitHub API.
 */


// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const RATE_LIMIT_URL = 'https://api.github.com/rate_limit';
const USER_AGENT = 'github-api-usage-monitor/1.0';
/**
 * Fetches rate limit data from GitHub API.
 *
 * @param token - GitHub token for authentication
 * @returns Rate limit response or error
 */
async function fetchRateLimit(token) {
    const timestamp = new Date().toISOString();
    // Set up abort controller with timeout to prevent indefinite hangs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(RATE_LIMIT_URL, {
            signal: controller.signal,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': USER_AGENT,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            const statusText = response.statusText || 'Unknown error';
            return {
                success: false,
                error: `HTTP ${response.status}: ${statusText}`,
                timestamp,
            };
        }
        const raw = await response.json();
        const parsed = parseRateLimitResponse(raw);
        if (!parsed) {
            return {
                success: false,
                error: 'Failed to parse rate limit response',
                timestamp,
            };
        }
        return {
            success: true,
            data: parsed,
            timestamp,
        };
    }
    catch (err) {
        clearTimeout(timeoutId);
        const error = err;
        // Handle abort error specifically (timeout)
        if (error.name === 'AbortError') {
            return {
                success: false,
                error: `Request timeout: GitHub API did not respond within ${FETCH_TIMEOUT_MS}ms`,
                timestamp,
            };
        }
        return {
            success: false,
            error: `Network error: ${error.message}`,
            timestamp,
        };
    }
}
// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
/**
 * Validates that a sample has the expected shape.
 * Used for defensive parsing.
 */
function isValidSample(sample) {
    if (!isARealObject(sample)) {
        return false;
    }
    const requiredFields = ['limit', 'used', 'remaining', 'reset'];
    return requiredFields.every((field) => typeof sample[field] === 'number');
}
/**
 * Parses raw API response into typed RateLimitResponse.
 * Returns null if parsing fails.
 */
function parseRateLimitResponse(raw) {
    if (!isARealObject(raw) || !isARealObject(raw['resources'])) {
        return null;
    }
    const resources = {};
    for (const [key, value] of Object.entries(raw['resources'])) {
        if (!isValidSample(value)) {
            return null;
        }
        resources[key] = value;
    }
    // Use rate if valid, otherwise fall back to resources.core
    const rawRate = raw['rate'];
    if (isValidSample(rawRate)) {
        return { resources, rate: rawRate };
    }
    const coreResource = resources['core'];
    if (coreResource) {
        return { resources, rate: coreResource };
    }
    return null;
}

;// CONCATENATED MODULE: ./src/reducer.ts
/**
 * Reducer
 * Layer: core
 *
 * Provided ports:
 *   - reducer.update
 *   - reducer.initBucket
 *
 * Pure business logic for rate-limit reduction.
 * Maintains constant-space per-bucket state.
 *
 * Algorithm (per poll, per bucket):
 *   if bucket not initialized:
 *     initialize with current reset/used
 *   else if reset changed AND used < last_used (genuine window reset):
 *     windows_crossed += 1
 *     total_used += used (include post-reset usage)
 *     last_reset = reset
 *   else if reset changed AND used >= last_used (timestamp rotation, not a real reset):
 *     delta = used - last_used
 *     total_used += delta
 *     last_reset = reset
 *   else (same window):
 *     delta = used - last_used
 *     if delta < 0: anomaly (do not subtract)
 *     else: total_used += delta
 *   last_used = used
 */

// -----------------------------------------------------------------------------
// Port: reducer.initBucket
// -----------------------------------------------------------------------------
/**
 * Initializes a new bucket state from the first sample.
 */
function initBucket(sample, timestamp) {
    return {
        last_reset: sample.reset,
        last_used: sample.used,
        total_used: 0, // First sample is baseline, not counted
        windows_crossed: 0,
        anomalies: 0,
        last_seen_ts: timestamp,
        limit: sample.limit,
        remaining: sample.remaining,
    };
}
/**
 * Updates a bucket state with a new sample.
 * Pure function - returns new state without mutating input.
 *
 * @param bucket - Current bucket state
 * @param sample - New rate limit sample
 * @param timestamp - ISO timestamp of observation
 */
function updateBucket(bucket, sample, timestamp) {
    const resetChanged = sample.reset !== bucket.last_reset;
    const usedDecreased = sample.used < bucket.last_used;
    // Genuine window reset: reset timestamp changed AND used count dropped.
    // This means the rate-limit window actually rolled over and the counter reset.
    if (resetChanged && usedDecreased) {
        return {
            bucket: {
                last_reset: sample.reset,
                last_used: sample.used,
                total_used: bucket.total_used + sample.used,
                windows_crossed: bucket.windows_crossed + 1,
                anomalies: bucket.anomalies,
                last_seen_ts: timestamp,
                limit: sample.limit,
                remaining: sample.remaining,
            },
            delta: sample.used,
            anomaly: false,
            window_crossed: true,
        };
    }
    // Reset timestamp rotated but used didn't drop (e.g. GitHub rotating
    // timestamps on unused buckets, or continued usage across a boundary).
    // Treat as a normal delta — update last_reset but don't count a crossing.
    if (resetChanged) {
        const delta = sample.used - bucket.last_used;
        return {
            bucket: {
                last_reset: sample.reset,
                last_used: sample.used,
                total_used: bucket.total_used + delta,
                windows_crossed: bucket.windows_crossed,
                anomalies: bucket.anomalies,
                last_seen_ts: timestamp,
                limit: sample.limit,
                remaining: sample.remaining,
            },
            delta,
            anomaly: false,
            window_crossed: false,
        };
    }
    // Same window: calculate delta
    const delta = sample.used - bucket.last_used;
    if (delta < 0) {
        // Anomaly: used decreased without reset change
        return {
            bucket: {
                ...bucket,
                last_used: sample.used,
                anomalies: bucket.anomalies + 1,
                last_seen_ts: timestamp,
                limit: sample.limit,
                remaining: sample.remaining,
            },
            delta: 0,
            anomaly: true,
            window_crossed: false,
        };
    }
    // Normal case: accumulate delta
    return {
        bucket: {
            ...bucket,
            last_used: sample.used,
            total_used: bucket.total_used + delta,
            last_seen_ts: timestamp,
            limit: sample.limit,
            remaining: sample.remaining,
        },
        delta,
        anomaly: false,
        window_crossed: false,
    };
}
// -----------------------------------------------------------------------------
// State factory
// -----------------------------------------------------------------------------
/**
 * Creates initial reducer state.
 */
function createInitialState() {
    return {
        buckets: {},
        started_at_ts: new Date().toISOString(),
        stopped_at_ts: null,
        poller_started_at_ts: null,
        interval_seconds: types_POLL_INTERVAL_SECONDS,
        poll_count: 0,
        poll_failures: 0,
        last_error: null,
    };
}
/**
 * Processes a full rate limit response and updates state.
 * Pure function - returns new state without mutating input.
 *
 * @param state - Current reducer state
 * @param response - Rate limit API response
 * @param timestamp - ISO timestamp of observation
 */
function reduce(state, response, timestamp) {
    const newBuckets = { ...state.buckets };
    const updates = {};
    // Process each bucket in the response
    for (const [name, sample] of Object.entries(response.resources)) {
        const existingBucket = state.buckets[name];
        if (!existingBucket) {
            // New bucket: initialize
            const bucket = initBucket(sample, timestamp);
            newBuckets[name] = bucket;
            updates[name] = {
                bucket,
                delta: 0,
                anomaly: false,
                window_crossed: false,
            };
        }
        else {
            // Existing bucket: update
            const result = updateBucket(existingBucket, sample, timestamp);
            newBuckets[name] = result.bucket;
            updates[name] = result;
        }
    }
    return {
        state: {
            ...state,
            buckets: newBuckets,
            poll_count: state.poll_count + 1,
        },
        updates,
    };
}
/**
 * Records a poll failure in state.
 * Pure function - returns new state.
 */
function recordFailure(state, error) {
    return {
        ...state,
        poll_failures: state.poll_failures + 1,
        last_error: error,
    };
}
/**
 * Marks state as stopped.
 */
function markStopped(state) {
    return {
        ...state,
        stopped_at_ts: new Date().toISOString(),
    };
}

;// CONCATENATED MODULE: external "fs"
const external_fs_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("fs");
;// CONCATENATED MODULE: ./src/paths.ts
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


// -----------------------------------------------------------------------------
// Port: paths.statePath
// -----------------------------------------------------------------------------
/**
 * Returns the absolute path to the state directory.
 * Creates the path string only; does not create the directory.
 *
 * @throws Error if RUNNER_TEMP is not set
 */
function paths_getStateDir() {
    const runnerTemp = process.env['RUNNER_TEMP'];
    if (!runnerTemp) {
        throw new Error('RUNNER_TEMP environment variable is not set');
    }
    return external_path_namespaceObject.join(runnerTemp, STATE_DIR_NAME);
}
/**
 * Returns the absolute path to state.json
 */
function getStatePath() {
    return external_path_namespaceObject.join(paths_getStateDir(), STATE_FILE_NAME);
}
// -----------------------------------------------------------------------------
// Port: paths.pidPath
// -----------------------------------------------------------------------------
/**
 * Returns the absolute path to poller.pid
 */
function paths_getPidPath() {
    return path.join(paths_getStateDir(), PID_FILE_NAME);
}
// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
/**
 * Returns the path for atomic write temporary file
 */
function getStateTmpPath() {
    return external_path_namespaceObject.join(paths_getStateDir(), `${STATE_FILE_NAME}.tmp`);
}

;// CONCATENATED MODULE: ./src/state.ts
/**
 * State Manager
 * Layer: core
 *
 * Provided ports:
 *   - state.read
 *   - state.write
 *
 * Manages persistent state in $RUNNER_TEMP.
 * Uses atomic rename for safe writes.
 */


/**
 * Reads reducer state from disk.
 *
 * @returns State or error with details
 */
function readState() {
    const statePath = getStatePath();
    try {
        const content = external_fs_namespaceObject.readFileSync(statePath, 'utf-8');
        const parsed = JSON.parse(content);
        // TODO: Validate parsed state has correct shape
        // For now, trust the structure
        if (!isValidState(parsed)) {
            return {
                success: false,
                error: 'Invalid state structure',
                notFound: false,
            };
        }
        return { success: true, state: parsed };
    }
    catch (err) {
        const error = err;
        if (error.code === 'ENOENT') {
            return {
                success: false,
                error: 'State file not found',
                notFound: true,
            };
        }
        return {
            success: false,
            error: `Failed to read state: ${error.message}`,
            notFound: false,
        };
    }
}
/**
 * Writes reducer state to disk atomically.
 * Creates state directory if it doesn't exist.
 * Cleans up temp file on failure to prevent orphaned files.
 *
 * @param state - State to persist
 */
function writeState(state) {
    const stateDir = paths_getStateDir();
    const statePath = getStatePath();
    const tmpPath = getStateTmpPath();
    try {
        // Ensure directory exists
        external_fs_namespaceObject.mkdirSync(stateDir, { recursive: true });
        // Write to temp file
        const content = JSON.stringify(state, null, 2);
        external_fs_namespaceObject.writeFileSync(tmpPath, content, 'utf-8');
        // Atomic rename
        external_fs_namespaceObject.renameSync(tmpPath, statePath);
        return { success: true };
    }
    catch (err) {
        // Clean up temp file on failure to prevent orphaned files
        try {
            external_fs_namespaceObject.unlinkSync(tmpPath);
        }
        catch {
            // Ignore cleanup errors - file may not exist
        }
        const error = err;
        return {
            success: false,
            error: `Failed to write state: ${error.message}`,
        };
    }
}
// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
/**
 * Validates that parsed JSON has the ReducerState shape.
 * Handles missing fields gracefully per spec (W4).
 */
function isValidState(obj) {
    if (!isARealObject(obj)) {
        return false;
    }
    // Required fields
    if (!isARealObject(obj['buckets'])) {
        return false;
    }
    if (typeof obj['started_at_ts'] !== 'string') {
        return false;
    }
    if (typeof obj['interval_seconds'] !== 'number') {
        return false;
    }
    if (typeof obj['poll_count'] !== 'number') {
        return false;
    }
    if (typeof obj['poll_failures'] !== 'number') {
        return false;
    }
    // Optional fields: must be string | null
    if (!isStringOrNull(obj['stopped_at_ts'])) {
        return false;
    }
    if (!isStringOrNull(obj['poller_started_at_ts'])) {
        return false;
    }
    if (!isStringOrNull(obj['last_error'])) {
        return false;
    }
    return true;
}
// -----------------------------------------------------------------------------
// PID file management
// -----------------------------------------------------------------------------


/**
 * Writes the poller PID to disk.
 */
function writePid(pid) {
    const pidPath = getPidPath();
    const stateDir = getStateDir();
    try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(pidPath, String(pid), 'utf-8');
        return { success: true };
    }
    catch (err) {
        const error = err;
        return {
            success: false,
            error: `Failed to write PID: ${error.message}`,
        };
    }
}
/**
 * Reads the poller PID from disk.
 */
function readPid() {
    const pidPath = getPidPath();
    try {
        const content = fs.readFileSync(pidPath, 'utf-8');
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? null : pid;
    }
    catch {
        return null;
    }
}
/**
 * Removes the PID file.
 */
function removePid() {
    const pidPath = getPidPath();
    try {
        fs.unlinkSync(pidPath);
    }
    catch {
        // Ignore errors - file may not exist
    }
}
// -----------------------------------------------------------------------------
// Startup verification
// -----------------------------------------------------------------------------
const STARTUP_TIMEOUT_MS = 5000;
const STARTUP_CHECK_INTERVAL_MS = 100;
/**
 * Waits for the poller to signal startup by setting poller_started_at_ts.
 *
 * The poller writes this timestamp immediately on startup, before any API calls.
 * This confirms:
 *   - Process spawned successfully
 *   - Environment variables were read
 *   - File I/O is working
 *
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @returns Success or error with details
 */
async function verifyPollerStartup(timeoutMs = STARTUP_TIMEOUT_MS) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const result = readState();
        if (result.success && result.state.poller_started_at_ts !== null) {
            return { success: true };
        }
        await sleep(STARTUP_CHECK_INTERVAL_MS);
    }
    return {
        success: false,
        error: `Poller did not signal startup within ${timeoutMs}ms`,
    };
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

;// CONCATENATED MODULE: ./src/poller.ts
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






/**
 * Spawns the poller as a detached background process.
 *
 * @param token - GitHub token for API calls
 * @returns PID of spawned process or error
 */
function spawnPoller(token) {
    try {
        // Resolve path to bundled poller entry
        // ncc bundles to dist/poller/index.js
        const actionPath = process.env['GITHUB_ACTION_PATH'];
        const baseDir = actionPath
            ? path.resolve(actionPath, 'dist')
            : path.dirname(process.argv[1] ?? '');
        const separator = baseDir.endsWith(path.sep) ? '' : path.sep;
        const pollerEntry = `${baseDir}${separator}poller${path.sep}index.js`;
        const child = spawn(process.execPath, [pollerEntry], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                GITHUB_API_MONITOR_TOKEN: token,
                GITHUB_API_MONITOR_INTERVAL: String(POLL_INTERVAL_SECONDS),
            },
        });
        // Allow parent to exit without waiting
        child.unref();
        if (!child.pid) {
            return { success: false, error: 'Failed to get child PID' };
        }
        return { success: true, pid: child.pid };
    }
    catch (err) {
        const error = err;
        return { success: false, error: `Failed to spawn poller: ${error.message}` };
    }
}
const KILL_TIMEOUT_MS = 3000;
const KILL_CHECK_INTERVAL_MS = 100;
/**
 * Kills the poller process by PID.
 * Sends SIGTERM for graceful shutdown.
 *
 * @param pid - Process ID to kill
 */
function killPoller(pid) {
    try {
        // Check if process exists
        process.kill(pid, 0);
        // Send SIGTERM
        process.kill(pid, 'SIGTERM');
        return { success: true };
    }
    catch (err) {
        const error = err;
        if (error.code === 'ESRCH') {
            return {
                success: false,
                error: 'Process not found',
                notFound: true,
            };
        }
        return {
            success: false,
            error: `Failed to kill poller: ${error.message}`,
            notFound: false,
        };
    }
}
/**
 * Kills poller with verification and SIGKILL escalation.
 * Sends SIGTERM, waits for exit, escalates to SIGKILL if needed.
 */
async function killPollerWithVerification(pid) {
    // Check if process exists
    if (!isProcessRunning(pid)) {
        return { success: false, error: 'Process not found', notFound: true };
    }
    // Send SIGTERM
    try {
        process.kill(pid, 'SIGTERM');
    }
    catch (err) {
        const error = err;
        if (error.code === 'ESRCH') {
            return { success: false, error: 'Process not found', notFound: true };
        }
        return { success: false, error: `Failed to send SIGTERM: ${error.message}`, notFound: false };
    }
    // Wait for process to die
    const startTime = Date.now();
    while (Date.now() - startTime < KILL_TIMEOUT_MS) {
        await poller_sleep(KILL_CHECK_INTERVAL_MS);
        if (!isProcessRunning(pid)) {
            return { success: true, escalated: false };
        }
    }
    // Escalate to SIGKILL
    try {
        process.kill(pid, 'SIGKILL');
        await poller_sleep(KILL_CHECK_INTERVAL_MS);
        if (!isProcessRunning(pid)) {
            return { success: true, escalated: true };
        }
        return { success: false, error: 'Process survived SIGKILL', notFound: false };
    }
    catch (err) {
        const error = err;
        if (error.code === 'ESRCH') {
            return { success: true, escalated: true }; // Died between check and kill
        }
        return { success: false, error: `Failed to send SIGKILL: ${error.message}`, notFound: false };
    }
}
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function poller_sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const BURST_THRESHOLD_S = 8;
const PRE_RESET_BUFFER_S = 3;
const POST_RESET_DELAY_S = 3;
const MIN_SLEEP_MS = 1000;
/**
 * Computes when to poll next based on upcoming bucket resets.
 *
 * Instead of a fixed interval, this targets polls just before bucket resets
 * to minimize the uncertainty window — the gap between the last pre-reset
 * observation and the actual reset.
 *
 * When a reset is imminent (≤8s away), enters "burst mode": two polls
 * bracket the reset boundary to capture both pre-reset and post-reset state.
 */
function computeSleepPlan(state, baseIntervalMs, nowEpochSeconds) {
    const activeResets = Object.values(state.buckets)
        .filter((b) => b.total_used > 0)
        .map((b) => b.last_reset)
        .filter((r) => r > nowEpochSeconds);
    if (activeResets.length === 0) {
        return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
    }
    const soonestReset = Math.min(...activeResets);
    const secondsUntilReset = soonestReset - nowEpochSeconds;
    if (secondsUntilReset <= 0) {
        // Reset already passed — poll quickly to pick up new window
        return { sleepMs: Math.min(2000, baseIntervalMs), burst: false, burstGapMs: 0 };
    }
    if (secondsUntilReset <= BURST_THRESHOLD_S) {
        // Close to reset — burst mode: poll before and after
        const preResetSleep = Math.max((secondsUntilReset - PRE_RESET_BUFFER_S) * 1000, MIN_SLEEP_MS);
        const burstGap = (PRE_RESET_BUFFER_S + POST_RESET_DELAY_S) * 1000;
        return { sleepMs: preResetSleep, burst: true, burstGapMs: burstGap };
    }
    if (secondsUntilReset * 1000 < baseIntervalMs) {
        // Reset coming before next regular poll — target pre-reset
        const targetSleep = (secondsUntilReset - PRE_RESET_BUFFER_S) * 1000;
        return { sleepMs: Math.max(targetSleep, MIN_SLEEP_MS), burst: false, burstGapMs: 0 };
    }
    return { sleepMs: baseIntervalMs, burst: false, burstGapMs: 0 };
}
// -----------------------------------------------------------------------------
// Poll debounce
// -----------------------------------------------------------------------------
/**
 * Minimum milliseconds between any two polls.
 *
 * Prevents rapid-fire polling when multiple buckets have staggered resets
 * close together (e.g. three 60s buckets resetting 5s apart). Without this,
 * each reset triggers its own burst, producing 6 polls in ~15s. The debounce
 * floors every sleep so back-to-back bursts collapse naturally.
 *
 * Tunable independently from computeSleepPlan's reset-targeting logic.
 */
const POLL_DEBOUNCE_MS = 5000;
/**
 * Applies a minimum-interval debounce to a sleep plan.
 * Clamps both the initial sleep and the burst gap (if any) so that no
 * two polls can occur closer than `debounceMs` apart.
 */
function applyDebounce(plan, debounceMs) {
    return {
        ...plan,
        sleepMs: Math.max(plan.sleepMs, debounceMs),
        burstGapMs: plan.burst ? Math.max(plan.burstGapMs, debounceMs) : plan.burstGapMs,
    };
}
// -----------------------------------------------------------------------------
// Poller main loop (when run as child process)
// -----------------------------------------------------------------------------
/**
 * Main polling loop.
 * Runs indefinitely until SIGTERM received.
 *
 * Startup sequence:
 *   1. Read or create initial state
 *   2. Write state immediately (signals "alive" to parent)
 *   3. Begin polling loop
 *
 * Shutdown sequence (SIGTERM):
 *   1. Write current state immediately
 *   2. Exit with code 0
 *
 * The parent process (main.ts) waits for the state file to confirm
 * the poller started successfully before proceeding.
 */
async function runPollerLoop(token, intervalSeconds) {
    let state;
    const startTimeMs = Date.now();
    // Handle graceful shutdown - write state immediately before exiting
    process.on('SIGTERM', () => {
        if (state) {
            writeState(state);
        }
        process.exit(0);
    });
    // Initial state or read existing
    const stateResult = readState();
    if (stateResult.success) {
        state = stateResult.state;
    }
    else {
        state = createInitialState();
    }
    // Signal alive: set timestamp and write state so parent can detect startup
    state = { ...state, poller_started_at_ts: new Date().toISOString() };
    writeState(state);
    // Initial poll immediately
    state = await performPoll(state, token);
    // Polling loop (runs until SIGTERM or max lifetime exceeded)
    while (true) {
        // Defense-in-depth: exit if max lifetime exceeded
        const elapsedMs = Date.now() - startTimeMs;
        if (elapsedMs >= MAX_LIFETIME_MS) {
            console.error(`Poller exceeded max lifetime (${MAX_LIFETIME_MS}ms). ` + `Exiting as safety measure.`);
            state = markStopped(state);
            writeState(state);
            process.exit(0);
        }
        const rawPlan = computeSleepPlan(state, intervalSeconds * 1000, Math.floor(Date.now() / 1000));
        const plan = applyDebounce(rawPlan, POLL_DEBOUNCE_MS);
        await poller_sleep(plan.sleepMs);
        state = await performPoll(state, token);
        if (plan.burst) {
            await poller_sleep(plan.burstGapMs);
            state = await performPoll(state, token);
        }
    }
}
/**
 * Performs a single poll and updates state.
 */
async function performPoll(state, token) {
    const timestamp = new Date().toISOString();
    const result = await fetchRateLimit(token);
    if (!result.success) {
        const newState = recordFailure(state, result.error);
        writeState(newState);
        return newState;
    }
    const { state: newState } = reduce(state, result.data, timestamp);
    writeState(newState);
    return newState;
}
// -----------------------------------------------------------------------------
// Child process entry point
// -----------------------------------------------------------------------------
/**
 * Entry point when run as child process.
 * Exported for use by poller-entry.ts
 */
async function main() {
    const token = process.env['GITHUB_API_MONITOR_TOKEN'];
    const intervalStr = process.env['GITHUB_API_MONITOR_INTERVAL'];
    if (!token) {
        console.error('GITHUB_API_MONITOR_TOKEN not set');
        process.exit(1);
    }
    const interval = intervalStr ? parseInt(intervalStr, 10) : types_POLL_INTERVAL_SECONDS;
    await runPollerLoop(token, interval);
}
// Entry point moved to poller-entry.ts for ESM compatibility
// See: poller-entry.ts is built as dist/poller/index.js

;// CONCATENATED MODULE: ./src/poller-entry.ts
/**
 * Poller Entry Point
 *
 * Separate entry file for ESM compatibility.
 * The require.main === module pattern doesn't work with ncc ESM bundling,
 * so we use a dedicated entry file that unconditionally calls main().
 *
 * Built as: dist/poller/index.js
 */

main().catch((err) => {
    console.error('Poller error:', err);
    process.exit(1);
});

