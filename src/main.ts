/**
 * Main Entry
 * Layer: action
 *
 * GitHub Action main entry point.
 *
 * Note: startup is handled by the pre hook (pre.ts). This entry is intentionally
 * a no-op so the action can be placed anywhere in the job without double-start.
 */

import * as core from '@actions/core';

// -----------------------------------------------------------------------------
// Action entry point
// -----------------------------------------------------------------------------

function run(): undefined {
  core.info('Monitor start is handled by the pre hook. Main step is a no-op.');
}

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

void run();
