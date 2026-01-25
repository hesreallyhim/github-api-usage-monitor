/**
 * Main Entry
 * Layer: action
 *
 * GitHub Action main entry point. Spawns the background poller.
 * Cleanup and reporting is handled by post.ts (via action.yml post entry).
 *
 * Required ports:
 *   - poller.spawn
 *   - state.write
 *   - github.fetchRateLimit
 */
export {};
