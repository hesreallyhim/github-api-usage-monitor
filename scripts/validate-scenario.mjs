/**
 * validate-scenario.mjs
 *
 * Validates a scenario's expectations against state.json in STATE_DIR.
 * Writes a markdown summary and exits non-zero only when STRICT_VALIDATION=true.
 *
 * Env:
 *   - SCENARIO_ID (required)
 *   - STATE_DIR (required)
 *   - STRICT_VALIDATION (optional, 'true' to fail on mismatch)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scenarioId = process.env.SCENARIO_ID || '';
const stateDir = process.env.STATE_DIR || '';
const strict = process.env.STRICT_VALIDATION === 'true';
const summaryPath = process.env.GITHUB_STEP_SUMMARY || '';

if (!scenarioId) {
  console.error('SCENARIO_ID is required.');
  process.exit(1);
}

if (!stateDir) {
  console.error('STATE_DIR is required.');
  process.exit(strict ? 1 : 0);
}

const statePath = join(stateDir, 'state.json');
if (!existsSync(statePath)) {
  const msg = 'SKIP — state.json not found';
  console.log(msg);
  if (summaryPath) {
    appendSummary(summaryPath, msg + '\n');
  }
  process.exit(strict ? 1 : 0);
}

const state = JSON.parse(readFileSync(statePath, 'utf-8'));
const buckets = state.buckets || {};

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), 'self-test-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const scenario = (manifest.scenarios || []).find((s) => s.id === scenarioId);

if (!scenario) {
  console.error(`Scenario not found: ${scenarioId}`);
  process.exit(1);
}

const expectations = scenario.expected || {};
const results = [];

for (const [bucketName, expect] of Object.entries(expectations)) {
  const bucket = buckets[bucketName];
  if (!bucket) {
    results.push([bucketName, 'exists', false, 'not found in state']);
    continue;
  }

  const usedOk = bucket.total_used >= expect.total_used_delta;
  results.push([
    bucketName,
    'total_used',
    usedOk,
    `${bucket.total_used} (expected >= ${expect.total_used_delta})`,
  ]);

  if (expect.windows_crossed_min !== undefined) {
    const winMinOk = bucket.windows_crossed >= expect.windows_crossed_min;
    results.push([
      bucketName,
      'windows_crossed>=',
      winMinOk,
      `${bucket.windows_crossed} (expected >= ${expect.windows_crossed_min})`,
    ]);
  }

  if (expect.windows_crossed_max !== undefined) {
    if (expect.windows_crossed_max === 0 && expect.windows_crossed_min === undefined) {
      const winEqOk = bucket.windows_crossed === 0;
      results.push([
        bucketName,
        'windows_crossed==',
        winEqOk,
        `${bucket.windows_crossed} (expected == 0)`,
      ]);
    } else {
      const winMaxOk = bucket.windows_crossed <= expect.windows_crossed_max;
      results.push([
        bucketName,
        'windows_crossed<=',
        winMaxOk,
        `${bucket.windows_crossed} (expected <= ${expect.windows_crossed_max})`,
      ]);
    }
  }
}

const allPassed = results.every((r) => r[2]);
const icon = allPassed ? 'PASS' : 'FAIL';
const md = [];
md.push(`### Validation: ${icon}`);
md.push('');
md.push('| Bucket | Check | Result | Detail |');
md.push('|--------|-------|:------:|--------|');
for (const [bucketName, check, passed, detail] of results) {
  const mark = passed ? 'pass' : 'FAIL';
  md.push(`| ${bucketName} | ${check} | ${mark} | ${detail} |`);
}
md.push('');

const mdText = md.join('\n');
console.log(mdText);
if (summaryPath) {
  appendSummary(summaryPath, mdText + '\n');
}

if (!allPassed && strict) {
  process.exit(1);
}

function appendSummary(path, text) {
  try {
    const current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    writeFileSync(path, current + text);
  } catch {
    writeFileSync(path, text);
  }
}
