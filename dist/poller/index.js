require('./sourcemap-register.js');/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 248:
/***/ ((__unused_webpack_module, exports) => {


/**
 * GitHub API Client
 * Layer: infra
 *
 * Provided ports:
 *   - github.fetchRateLimit
 *
 * Fetches rate limit data from the GitHub API.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.fetchRateLimit = fetchRateLimit;
exports.isValidSample = isValidSample;
exports.parseRateLimitResponse = parseRateLimitResponse;
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
    try {
        const response = await fetch(RATE_LIMIT_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': USER_AGENT,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
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
        const error = err;
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
    if (typeof sample !== 'object' || sample === null) {
        return false;
    }
    const s = sample;
    return (typeof s['limit'] === 'number' &&
        typeof s['used'] === 'number' &&
        typeof s['remaining'] === 'number' &&
        typeof s['reset'] === 'number');
}
/**
 * Parses raw API response into typed RateLimitResponse.
 * Returns null if parsing fails.
 */
function parseRateLimitResponse(raw) {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const obj = raw;
    // Validate resources exists and is an object
    if (typeof obj['resources'] !== 'object' || obj['resources'] === null) {
        return null;
    }
    const rawResources = obj['resources'];
    const resources = {};
    // Validate each resource is a valid sample
    for (const [key, value] of Object.entries(rawResources)) {
        if (!isValidSample(value)) {
            return null;
        }
        resources[key] = {
            limit: value.limit,
            used: value.used,
            remaining: value.remaining,
            reset: value.reset,
        };
    }
    // Validate rate exists and is valid (deprecated but still returned)
    const rawRate = obj['rate'];
    if (isValidSample(rawRate)) {
        return {
            resources,
            rate: {
                limit: rawRate.limit,
                used: rawRate.used,
                remaining: rawRate.remaining,
                reset: rawRate.reset,
            },
        };
    }
    // If rate is missing but resources.core exists, use that as fallback
    const coreResource = resources['core'];
    if (coreResource) {
        return {
            resources,
            rate: coreResource,
        };
    }
    return null;
}


/***/ }),

/***/ 431:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {


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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getStateDir = getStateDir;
exports.getStatePath = getStatePath;
exports.getPidPath = getPidPath;
exports.getStateTmpPath = getStateTmpPath;
const path = __importStar(__nccwpck_require__(928));
const types_1 = __nccwpck_require__(522);
// -----------------------------------------------------------------------------
// Port: paths.statePath
// -----------------------------------------------------------------------------
/**
 * Returns the absolute path to the state directory.
 * Creates the path string only; does not create the directory.
 *
 * @throws Error if RUNNER_TEMP is not set
 */
function getStateDir() {
    const runnerTemp = process.env['RUNNER_TEMP'];
    if (!runnerTemp) {
        throw new Error('RUNNER_TEMP environment variable is not set');
    }
    return path.join(runnerTemp, types_1.STATE_DIR_NAME);
}
/**
 * Returns the absolute path to state.json
 */
function getStatePath() {
    return path.join(getStateDir(), types_1.STATE_FILE_NAME);
}
// -----------------------------------------------------------------------------
// Port: paths.pidPath
// -----------------------------------------------------------------------------
/**
 * Returns the absolute path to poller.pid
 */
function getPidPath() {
    return path.join(getStateDir(), types_1.PID_FILE_NAME);
}
// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
/**
 * Returns the path for atomic write temporary file
 */
function getStateTmpPath() {
    return path.join(getStateDir(), `${types_1.STATE_FILE_NAME}.tmp`);
}


/***/ }),

/***/ 105:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {


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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.spawnPoller = spawnPoller;
exports.killPoller = killPoller;
const child_process_1 = __nccwpck_require__(317);
const path = __importStar(__nccwpck_require__(928));
const types_1 = __nccwpck_require__(522);
const github_1 = __nccwpck_require__(248);
const reducer_1 = __nccwpck_require__(807);
const state_1 = __nccwpck_require__(462);
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
        const pollerEntry = path.resolve(__dirname, 'poller', 'index.js');
        const child = (0, child_process_1.spawn)(process.execPath, [pollerEntry], {
            detached: true,
            stdio: 'ignore',
            env: {
                ...process.env,
                GITHUB_API_MONITOR_TOKEN: token,
                GITHUB_API_MONITOR_INTERVAL: String(types_1.POLL_INTERVAL_SECONDS),
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
// -----------------------------------------------------------------------------
// Poller main loop (when run as child process)
// -----------------------------------------------------------------------------
/**
 * Main polling loop.
 * Runs indefinitely until SIGTERM received.
 */
async function runPollerLoop(token, intervalSeconds) {
    let running = true;
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        running = false;
    });
    // Initial state or read existing
    const stateResult = (0, state_1.readState)();
    let state;
    if (stateResult.success) {
        state = stateResult.state;
    }
    else {
        state = (0, reducer_1.createInitialState)();
    }
    // Initial poll immediately
    state = await performPoll(state, token);
    // Polling loop
    while (running) {
        await sleep(intervalSeconds * 1000);
        if (!running)
            break;
        state = await performPoll(state, token);
    }
    // Final state write on shutdown
    (0, state_1.writeState)(state);
}
/**
 * Performs a single poll and updates state.
 */
async function performPoll(state, token) {
    const timestamp = new Date().toISOString();
    const result = await (0, github_1.fetchRateLimit)(token);
    if (!result.success) {
        const newState = (0, reducer_1.recordFailure)(state, result.error);
        (0, state_1.writeState)(newState);
        return newState;
    }
    const { state: newState } = (0, reducer_1.reduce)(state, result.data, timestamp);
    (0, state_1.writeState)(newState);
    return newState;
}
/**
 * Sleep helper.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// -----------------------------------------------------------------------------
// Child process entry point
// -----------------------------------------------------------------------------
/**
 * Entry point when run as child process.
 */
async function main() {
    const token = process.env['GITHUB_API_MONITOR_TOKEN'];
    const intervalStr = process.env['GITHUB_API_MONITOR_INTERVAL'];
    if (!token) {
        console.error('GITHUB_API_MONITOR_TOKEN not set');
        process.exit(1);
    }
    const interval = intervalStr ? parseInt(intervalStr, 10) : types_1.POLL_INTERVAL_SECONDS;
    await runPollerLoop(token, interval);
}
// Run if this is the entry point
if (require.main === require.cache[eval('__filename')]) {
    main().catch((err) => {
        console.error('Poller error:', err);
        process.exit(1);
    });
}


/***/ }),

/***/ 807:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {


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
 *   else if reset == last_reset (same window):
 *     delta = used - last_used
 *     if delta < 0: anomaly (do not subtract)
 *     else: total_used += delta
 *   else (new window):
 *     windows_crossed += 1
 *     total_used += used (include post-reset usage)
 *     last_reset = reset
 *   last_used = used
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.initBucket = initBucket;
exports.updateBucket = updateBucket;
exports.createInitialState = createInitialState;
exports.reduce = reduce;
exports.recordFailure = recordFailure;
exports.markStopped = markStopped;
const types_1 = __nccwpck_require__(522);
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
    // Check if reset changed (window boundary)
    if (sample.reset !== bucket.last_reset) {
        // New window: include post-reset used count
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
        interval_seconds: types_1.POLL_INTERVAL_SECONDS,
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


/***/ }),

/***/ 462:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {


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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.readState = readState;
exports.writeState = writeState;
exports.isValidState = isValidState;
exports.writePid = writePid;
exports.readPid = readPid;
exports.removePid = removePid;
const fs = __importStar(__nccwpck_require__(896));
const paths_1 = __nccwpck_require__(431);
/**
 * Reads reducer state from disk.
 *
 * @returns State or error with details
 */
function readState() {
    const statePath = (0, paths_1.getStatePath)();
    try {
        const content = fs.readFileSync(statePath, 'utf-8');
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
 *
 * @param state - State to persist
 */
function writeState(state) {
    const stateDir = (0, paths_1.getStateDir)();
    const statePath = (0, paths_1.getStatePath)();
    const tmpPath = (0, paths_1.getStateTmpPath)();
    try {
        // Ensure directory exists
        fs.mkdirSync(stateDir, { recursive: true });
        // Write to temp file
        const content = JSON.stringify(state, null, 2);
        fs.writeFileSync(tmpPath, content, 'utf-8');
        // Atomic rename
        fs.renameSync(tmpPath, statePath);
        return { success: true };
    }
    catch (err) {
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
function isValidState(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const obj = value;
    // Required fields
    if (typeof obj['buckets'] !== 'object' || obj['buckets'] === null) {
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
    // Optional fields have defaults in the type
    // stopped_at_ts: string | null
    // last_error: string | null
    return true;
}
// -----------------------------------------------------------------------------
// PID file management
// -----------------------------------------------------------------------------
const paths_2 = __nccwpck_require__(431);
/**
 * Writes the poller PID to disk.
 */
function writePid(pid) {
    const pidPath = (0, paths_2.getPidPath)();
    const stateDir = (0, paths_1.getStateDir)();
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
    const pidPath = (0, paths_2.getPidPath)();
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
    const pidPath = (0, paths_2.getPidPath)();
    try {
        fs.unlinkSync(pidPath);
    }
    catch {
        // Ignore errors - file may not exist
    }
}


/***/ }),

/***/ 522:
/***/ ((__unused_webpack_module, exports) => {


/**
 * Boundary types for github-api-usage-monitor v1
 * Generated from spec/spec.json
 *
 * These types define the contracts between modules.
 * Do not modify without updating the spec.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PID_FILE_NAME = exports.STATE_FILE_NAME = exports.STATE_DIR_NAME = exports.POLL_INTERVAL_SECONDS = void 0;
// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
exports.POLL_INTERVAL_SECONDS = 30;
exports.STATE_DIR_NAME = 'github-api-usage-monitor';
exports.STATE_FILE_NAME = 'state.json';
exports.PID_FILE_NAME = 'poller.pid';


/***/ }),

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(105);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=index.js.map