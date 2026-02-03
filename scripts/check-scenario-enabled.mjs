/**
 * check-scenario-enabled.mjs
 *
 * Emits enabled=true/false based on workflow_dispatch inputs for a scenario.
 * Uses SCENARIO_ID to map to input name: run_<id> (hyphens -> underscores).
 *
 * Env:
 *   - SCENARIO_ID (required)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const scenarioId = process.env.SCENARIO_ID || '';
if (!scenarioId) {
  console.error('SCENARIO_ID is required.');
  process.exit(1);
}

const inputName = `run_${scenarioId.replace(/-/g, '_')}`;
const eventPath = process.env.GITHUB_EVENT_PATH || '';
let enabled = true;

if (eventPath) {
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8'));
    const inputs = event.inputs || {};
    if (Object.prototype.hasOwnProperty.call(inputs, inputName)) {
      const value = String(inputs[inputName]).toLowerCase();
      enabled = value === 'true' || value === '1' || value === 'yes' || value === 'on';
    }
  } catch (error) {
    console.warn('Failed to parse GITHUB_EVENT_PATH; defaulting to enabled.');
  }
}

const outputPath = process.env.GITHUB_OUTPUT || '';
if (!outputPath) {
  console.error('GITHUB_OUTPUT is not set.');
  process.exit(1);
}

writeFileSync(outputPath, `enabled=${enabled}\n`, { flag: 'a' });
console.log(`Scenario ${scenarioId} enabled: ${enabled}`);
