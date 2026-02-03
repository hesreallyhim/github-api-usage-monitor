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
;// CONCATENATED MODULE: ./src/poller/spawn.ts
/**
 * Poller Process Spawning
 *
 * Spawns the poller as a detached background child process.
 * Extracted from poller.ts for testability.
 */



/**
 * Spawns the poller as a detached background process.
 *
 * @param token - GitHub token for API calls
 * @param diagnosticsEnabled - Enable poll log diagnostics
 * @returns PID of spawned process or error
 */
function spawnPoller(token, diagnosticsEnabled) {
    try {
        // Resolve path to bundled poller entry
        // ncc bundles to dist/poller/index.js
        const actionPath = process.env['GITHUB_ACTION_PATH'];
        const baseDir = actionPath
            ? path.resolve(actionPath, 'dist')
            : path.dirname(process.argv[1] ?? '');
        const pollerEntry = path.join(baseDir, 'poller', 'index.js');
        const child = spawn(process.execPath, [pollerEntry], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                GITHUB_API_MONITOR_TOKEN: token,
                GITHUB_API_MONITOR_INTERVAL: String(POLL_INTERVAL_SECONDS),
                GITHUB_API_MONITOR_DIAGNOSTICS: diagnosticsEnabled ? 'true' : 'false',
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
const POLL_LOG_FILE_NAME = 'poll-log.jsonl';
/** Timeout for fetch requests to GitHub API (milliseconds) */
const FETCH_TIMEOUT_MS = 10000;
/** Maximum poller lifetime as defense-in-depth (6 hours in milliseconds) */
const MAX_LIFETIME_MS = 6 * 60 * 60 * 1000;

;// CONCATENATED MODULE: ./src/utils.ts
/**
 * Checks if input is an object and not null.
 */
const isARealObject = (value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};
/**
 * Checks if input is a string or null.
 * Used for validating optional string fields in state.
 */
const isStringOrNull = (value) => {
    return value === null || typeof value === 'string';
};
/**
 * Parses a string flag value as boolean.
 * Recognises 'true', '1', 'yes', 'on' (case-insensitive, trimmed).
 */
function parseBooleanFlag(raw) {
    if (!raw)
        return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
/**
 * Returns a promise that resolves after the given milliseconds.
 */
function utils_sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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
const USER_AGENT = 'github-api-usage-monitor';
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
            continue; // Skip invalid resources instead of failing the entire response
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
        first_used: sample.used,
        first_remaining: sample.remaining,
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
                first_used: bucket.first_used,
                first_remaining: bucket.first_remaining,
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
                first_used: bucket.first_used,
                first_remaining: bucket.first_remaining,
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
                last_reset: bucket.last_reset,
                last_used: sample.used,
                total_used: bucket.total_used,
                windows_crossed: bucket.windows_crossed,
                anomalies: bucket.anomalies + 1,
                last_seen_ts: timestamp,
                limit: sample.limit,
                remaining: sample.remaining,
                first_used: bucket.first_used,
                first_remaining: bucket.first_remaining,
            },
            delta: 0,
            anomaly: true,
            window_crossed: false,
        };
    }
    // Normal case: accumulate delta
    return {
        bucket: {
            last_reset: bucket.last_reset,
            last_used: sample.used,
            total_used: bucket.total_used + delta,
            windows_crossed: bucket.windows_crossed,
            anomalies: bucket.anomalies,
            last_seen_ts: timestamp,
            limit: sample.limit,
            remaining: sample.remaining,
            first_used: bucket.first_used,
            first_remaining: bucket.first_remaining,
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
// Port: paths.pollLogPath
// -----------------------------------------------------------------------------
/**
 * Returns the absolute path to poll-log.jsonl
 */
function paths_getPollLogPath() {
    return external_path_namespaceObject.join(paths_getStateDir(), POLL_LOG_FILE_NAME);
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
    // Validate each bucket entry
    for (const value of Object.values(obj['buckets'])) {
        if (!isValidBucketState(value)) {
            return false;
        }
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
/**
 * Validates that a value has the BucketState shape.
 */
function isValidBucketState(value) {
    if (!isARealObject(value)) {
        return false;
    }
    const numericFields = [
        'last_reset',
        'last_used',
        'total_used',
        'windows_crossed',
        'anomalies',
        'limit',
        'remaining',
        'first_used',
        'first_remaining',
    ];
    for (const field of numericFields) {
        if (typeof value[field] !== 'number') {
            return false;
        }
    }
    if (typeof value['last_seen_ts'] !== 'string') {
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

;// CONCATENATED MODULE: ./src/poll-log.ts
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
function appendPollLogEntry(entry) {
    try {
        const line = JSON.stringify(entry) + '\n';
        external_fs_namespaceObject.appendFileSync(paths_getPollLogPath(), line, 'utf-8');
    }
    catch {
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
function readPollLog() {
    try {
        const path = getPollLogPath();
        if (!fs.existsSync(path))
            return [];
        const content = fs.readFileSync(path, 'utf-8');
        return content
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    catch {
        return [];
    }
}

;// CONCATENATED MODULE: ./src/poller/perform-poll.ts
/**
 * Single Poll Orchestration
 *
 * Performs one poll cycle: fetch rate limit, reduce state, write state,
 * and optionally append diagnostics.
 * Extracted from poller.ts for testability.
 */




/**
 * Builds a diagnostics poll log entry from reduce results and raw API data.
 * Pure function — testable with zero mocks.
 */
function buildDiagnosticsEntry(reduceResult, rateLimitData, pollCount, timestamp) {
    const bucketSnapshots = {};
    for (const [name, update] of Object.entries(reduceResult.updates)) {
        const sample = rateLimitData.resources[name];
        if (sample) {
            bucketSnapshots[name] = {
                used: sample.used,
                remaining: sample.remaining,
                reset: sample.reset,
                limit: sample.limit,
                delta: update.delta,
                window_crossed: update.window_crossed,
                anomaly: update.anomaly,
            };
        }
    }
    return {
        timestamp,
        poll_number: pollCount,
        buckets: bucketSnapshots,
    };
}
/**
 * Performs a single poll and updates state.
 */
async function performPoll(state, token, diagnosticsEnabled) {
    const timestamp = new Date().toISOString();
    const result = await fetchRateLimit(token);
    if (!result.success) {
        const newState = recordFailure(state, result.error);
        writeState(newState);
        return newState;
    }
    const reduceResult = reduce(state, result.data, timestamp);
    const newState = reduceResult.state;
    writeState(newState);
    if (diagnosticsEnabled) {
        const logEntry = buildDiagnosticsEntry(reduceResult, result.data, newState.poll_count, timestamp);
        appendPollLogEntry(logEntry);
    }
    return newState;
}

;// CONCATENATED MODULE: ./src/poller/sleep-plan.ts
/**
 * Adaptive Sleep Planning
 *
 * Pure functions for computing when to poll next based on upcoming bucket resets.
 * Extracted from poller.ts for testability.
 */
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

;// CONCATENATED MODULE: ./src/poller/loop.ts
/**
 * Poller Main Loop & Entry Point
 *
 * The polling loop and child process entry point.
 * Extracted from poller.ts for testability via dependency injection.
 */






/**
 * Returns true if the GITHUB_API_MONITOR_DIAGNOSTICS env var is truthy.
 */
function isDiagnosticsEnabled() {
    return parseBooleanFlag(process.env['GITHUB_API_MONITOR_DIAGNOSTICS']);
}
/**
 * Creates a SIGTERM handler that writes current state and exits.
 * Replaces the anonymous closure for testability.
 *
 * @param getState - Returns current reducer state (or undefined if not yet initialized)
 * @param writeFn - State persistence function
 * @param exitFn - Process exit function
 */
function createShutdownHandler(getState, writeFn, exitFn) {
    return () => {
        const state = getState();
        if (state) {
            writeFn(state);
        }
        exitFn(0);
    };
}
const defaultDeps = {
    registerSignal: (event, handler) => {
        process.on(event, handler);
    },
    exit: (code) => {
        process.exit(code);
    },
    now: () => Date.now(),
    performPoll: performPoll,
};
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
async function runPollerLoop(token, intervalSeconds, diagnosticsEnabled, deps = defaultDeps) {
    let state;
    const startTimeMs = deps.now();
    // Handle graceful shutdown - write state immediately before exiting
    const shutdownHandler = createShutdownHandler(() => state, writeState, deps.exit);
    deps.registerSignal('SIGTERM', shutdownHandler);
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
    state = await deps.performPoll(state, token, diagnosticsEnabled);
    // Polling loop (runs until SIGTERM or max lifetime exceeded)
    while (true) {
        try {
            // Defense-in-depth: exit if max lifetime exceeded
            const elapsedMs = deps.now() - startTimeMs;
            if (elapsedMs >= MAX_LIFETIME_MS) {
                console.error(`Poller exceeded max lifetime (${MAX_LIFETIME_MS}ms). ` + `Exiting as safety measure.`);
                state = markStopped(state);
                writeState(state);
                deps.exit(0);
                return;
            }
            const rawPlan = computeSleepPlan(state, intervalSeconds * 1000, Math.floor(deps.now() / 1000));
            const plan = applyDebounce(rawPlan, POLL_DEBOUNCE_MS);
            await utils_sleep(plan.sleepMs);
            state = await deps.performPoll(state, token, diagnosticsEnabled);
            if (plan.burst) {
                await utils_sleep(plan.burstGapMs);
                state = await deps.performPoll(state, token, diagnosticsEnabled);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Poller loop error: ${message}`);
            // Avoid a tight loop; fall back to the base interval before trying again.
            await utils_sleep(intervalSeconds * 1000);
        }
    }
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
    const diagnosticsEnabled = isDiagnosticsEnabled();
    if (!token) {
        console.error('GITHUB_API_MONITOR_TOKEN not set');
        process.exit(1);
    }
    const interval = intervalStr ? parseInt(intervalStr, 10) : types_POLL_INTERVAL_SECONDS;
    await runPollerLoop(token, interval, diagnosticsEnabled);
}

;// CONCATENATED MODULE: ./src/poller/index.ts






;// CONCATENATED MODULE: ./src/poller.ts
/**
 * Poller Process — Barrel Re-export
 *
 * All poller functionality has been split into focused modules under ./poller/.
 * This file re-exports everything for backward compatibility.
 */


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

