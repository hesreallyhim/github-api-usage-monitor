/**
 * generate-self-test.ts
 *
 * Generates .github/workflows/self-test.yml from the declarative scenario
 * definitions in ./scenarios.ts.
 *
 * Usage:  npx tsx scripts/generate-self-test.ts
 *
 * This file is the "generator" half of the declarative self-test system.
 * See docs/planning/IMPL-PLAN-declarative-self-test.md for full context.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";
import { SCENARIOS } from "./scenarios.js";
import type { Scenario, EndpointCalls } from "./scenarios.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "..", ".github", "workflows", "self-test.yml");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Indent every line of a multi-line string by `n` spaces. */
function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/**
 * Compute remaining sleep after curl calls finish.
 * Estimate: each curl call takes ~2s of wall-clock time, plus inter_call_sleep.
 * Minimum remaining sleep is 10s so we never skip the wait entirely.
 */
function computeRemainingSleep(scenario: Scenario): number {
  let estimatedCallTime = 0;
  for (const ec of scenario.endpoint_calls) {
    estimatedCallTime += ec.calls * (2 + scenario.inter_call_sleep_s);
  }
  return Math.max(10, scenario.poll_duration_s - estimatedCallTime);
}

// ---------------------------------------------------------------------------
// Curl generation
// ---------------------------------------------------------------------------

function generateCurlBlock(ec: EndpointCalls, interCallSleep: number): string {
  const ep = ec.endpoint;
  const lines: string[] = [];

  lines.push(`# ${ec.calls}x ${ep.bucket}`);
  lines.push(`for i in $(seq 1 ${ec.calls}); do`);
  lines.push(`  echo "--- ${ep.bucket} call $i ---"`);

  // Build curl command parts
  const curlParts: string[] = [
    "curl -s -o /dev/null -w \"HTTP %{http_code}\\n\"",
    "  -D -",
    '  -H "Authorization: Bearer $TOKEN"',
  ];

  if (ep.method === "POST") {
    if (ep.contentType) {
      curlParts.push(`  -H "Content-Type: ${ep.contentType}"`);
    }
    if (ep.body) {
      curlParts.push(`  -d '${ep.body}'`);
    }
  }

  curlParts.push(`  "${ep.url}"`);

  lines.push("  " + curlParts.join(" \\\n    ") + " \\");
  lines.push("    2>&1 | grep -iE '(^HTTP|x-ratelimit)'");

  if (interCallSleep > 0) {
    lines.push(`  sleep ${interCallSleep}`);
  }

  lines.push("done");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Validation script generation (python3 inline)
// ---------------------------------------------------------------------------

function generateValidationScript(scenario: Scenario): string {
  // Build Python dict literal for expectations
  const entries: string[] = [];
  for (const [bucket, exp] of Object.entries(scenario.expected)) {
    entries.push(
      `    '${bucket}': {'delta': ${exp.total_used_delta}, 'max_windows': ${exp.windows_crossed_max}}`
    );
  }
  const expectDict = "{\n" + entries.join(",\n") + "\n}";

  // NOTE: This script is embedded inside a YAML block scalar (run: |) and then
  // passed to python3 via heredoc, so we can use both single and double quotes
  // freely. We avoid f-strings with bracket expressions to keep it simple.
  const lines: string[] = [
    "import json, sys, os",
    "state_path = os.path.join(os.environ['STATE_DIR'], 'state.json')",
    "with open(state_path) as f:",
    "    state = json.load(f)",
    "buckets = state.get('buckets', {})",
    `expectations = ${expectDict}`,
    "errors = []",
    "for bucket_name, expect in expectations.items():",
    "    b = buckets.get(bucket_name)",
    "    if not b:",
    "        errors.append(bucket_name + ': not found in state')",
    "        continue",
    "    if b['total_used'] < expect['delta']:",
    "        errors.append(bucket_name + ': total_used=' + str(b['total_used']) + ' < expected ' + str(expect['delta']))",
    "    if b['windows_crossed'] > expect['max_windows']:",
    "        errors.append(bucket_name + ': windows_crossed=' + str(b['windows_crossed']) + ' > max ' + str(expect['max_windows']))",
    "if errors:",
    "    print('VALIDATION FAILED:')",
    "    for e in errors: print('  - ' + e)",
    "    sys.exit(1)",
    "print('All assertions passed')",
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-job YAML generation
// ---------------------------------------------------------------------------

function generateJob(scenario: Scenario, previousId: string | null): string {
  const lines: string[] = [];

  lines.push(`${scenario.id}:`);
  lines.push(`  runs-on: ubuntu-latest`);
  if (previousId !== null) {
    lines.push(`  needs: [${previousId}]`);
  }
  lines.push(`  steps:`);
  lines.push(`    - uses: actions/checkout@v4`);
  lines.push(``);
  lines.push(`    - name: Start monitor`);
  lines.push(`      uses: ./`);
  lines.push(`      with:`);
  lines.push(`        token: \${{ secrets.GITHUB_TOKEN }}`);

  // Scenario step: curl calls (only if there are endpoint_calls with calls > 0)
  const hasCallSteps = scenario.endpoint_calls.some((ec) => ec.calls > 0);
  if (hasCallSteps) {
    lines.push(``);
    lines.push(`    - name: "Scenario: ${scenario.name}"`);
    lines.push(`      env:`);
    lines.push(`        TOKEN: \${{ secrets.GITHUB_TOKEN }}`);
    lines.push(`        REPO: \${{ github.repository }}`);
    lines.push(`      run: |`);

    const curlBlocks = scenario.endpoint_calls
      .filter((ec) => ec.calls > 0)
      .map((ec) => generateCurlBlock(ec, scenario.inter_call_sleep_s));

    const curlScript = curlBlocks.join("\n\n");
    lines.push(indent(curlScript, 8));
  }

  // Wait step
  const remainingSleep = computeRemainingSleep(scenario);
  lines.push(``);
  lines.push(
    `    - name: "Wait for polls (${scenario.poll_duration_s}s total)"`
  );
  lines.push(`      run: sleep ${remainingSleep}`);

  // Dump state.json step
  lines.push(``);
  lines.push(`    - name: Dump state.json`);
  lines.push(`      run: |`);
  lines.push(
    `        STATE_FILE="\${RUNNER_TEMP}/github-api-usage-monitor/state.json"`
  );
  lines.push(`        echo "=== ${scenario.id}: state.json ==="`);
  lines.push(`        if [ -f "$STATE_FILE" ]; then`);
  lines.push(`          cat "$STATE_FILE" | python3 -m json.tool`);
  lines.push(`        else`);
  lines.push(`          echo "state.json not found"`);
  lines.push(`        fi`);

  // Validation step (only if scenario has expected entries)
  const hasExpected = Object.keys(scenario.expected).length > 0;
  if (hasExpected) {
    lines.push(``);
    lines.push(`    - name: Validate expectations`);
    lines.push(`      if: inputs.strict_validation == 'true'`);
    lines.push(`      env:`);
    lines.push(`        STATE_DIR: \${{ runner.temp }}/github-api-usage-monitor`);
    lines.push(`      run: |`);
    lines.push(`        python3 << 'PYEOF'`);

    const validationScript = generateValidationScript(scenario);
    lines.push(indent(validationScript, 8));

    lines.push(`        PYEOF`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Full workflow YAML generation
// ---------------------------------------------------------------------------

function generateWorkflow(): string {
  const header = `# AUTO-GENERATED by scripts/generate-self-test.ts — do not edit manually
# Regenerate: npx tsx scripts/generate-self-test.ts

name: Self-Test

on:
  workflow_dispatch:
    inputs:
      strict_validation:
        description: "Fail jobs on assertion mismatch"
        type: boolean
        default: false

concurrency:
  group: self-test
  cancel-in-progress: true

jobs:`;

  const jobBlocks: string[] = [];
  let previousId: string | null = null;

  for (const scenario of SCENARIOS) {
    jobBlocks.push(indent(generateJob(scenario, previousId), 2));
    previousId = scenario.id;
  }

  return header + "\n" + jobBlocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const yaml = generateWorkflow();

  // Ensure output directory exists
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(outputPath, yaml, "utf-8");

  // Print summary
  console.log(`Generated: ${outputPath}`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Job IDs:`);
  for (const s of SCENARIOS) {
    console.log(`  - ${s.id} ("${s.name}")`);
  }
}

main();
