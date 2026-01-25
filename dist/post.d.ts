/**
 * Post Entry
 * Layer: action
 *
 * GitHub Action post entry point for cleanup and reporting.
 * Runs automatically after job completes (via action.yml post-if: always()).
 *
 * Required ports:
 *   - poller.kill
 *   - state.read
 *   - output.render
 */
export {};
