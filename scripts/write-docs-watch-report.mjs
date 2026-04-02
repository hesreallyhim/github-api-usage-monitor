#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

function getArgValue(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value ?? fallback;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function shortHash(value) {
  if (!value) return 'missing';
  const text = String(value);
  return text.length <= 12 ? text : text.slice(0, 12);
}

function parsePatchStats(patchText) {
  const stats = new Map();

  if (!patchText.trim()) {
    return stats;
  }

  let currentFile = null;
  for (const line of patchText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      currentFile = match ? match[1] : null;
      if (currentFile && !stats.has(currentFile)) {
        stats.set(currentFile, {
          file: currentFile,
          additions: 0,
          deletions: 0,
          hunks: 0,
        });
      }
      continue;
    }

    if (!currentFile) continue;

    const current = stats.get(currentFile);
    if (!current) continue;

    if (line.startsWith('@@')) {
      current.hunks += 1;
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.additions += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      current.deletions += 1;
    }
  }

  return stats;
}

function defaultAssessment(payload) {
  if (!payload.changed) {
    return {
      status: 'completed',
      impactLevel: 'none',
      requiresProjectChanges: 'false',
      confidence: '0.95',
      rationale: 'No monitored documentation changes were detected in this run.',
      recommendedAction: 'No action required.',
    };
  }

  return {
    status: 'pending-codex-review',
    impactLevel: 'pending',
    requiresProjectChanges: 'unknown',
    confidence: 'n/a',
    rationale:
      'Changes were detected. Review the diff report and classify whether project code or docs need updates.',
    recommendedAction:
      'Review `.tmp/docs-watch/docs-diff.md`, classify impact, and open/update a draft PR if changes are required.',
  };
}

function escapePipe(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

async function main() {
  const checkPath = getArgValue('--check', '.tmp/docs-watch/docs-check.json');
  const diffPath = getArgValue('--diff', '.tmp/docs-watch/docs-diff.patch');
  const diffMarkdownPath = getArgValue('--diff-markdown', '.tmp/docs-watch/docs-diff.md');
  const outputPath = getArgValue('--output', '.tmp/docs-watch/docs-watch-report.md');
  const writeSummary = args.includes('--write-summary');

  const checkPayload = JSON.parse(fs.readFileSync(checkPath, 'utf8'));
  const changed = checkPayload.results.filter((item) => item.changed);
  const patchText = fs.existsSync(diffPath) ? fs.readFileSync(diffPath, 'utf8') : '';
  const patchStats = parsePatchStats(patchText);

  const assessment = defaultAssessment(checkPayload);

  const lines = [];
  lines.push('# Docs Watch Run Report');
  lines.push('');
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- check_file: ${checkPath}`);
  lines.push(`- diff_patch_file: ${diffPath}`);
  lines.push(`- diff_markdown_file: ${diffMarkdownPath}`);
  lines.push(`- changed: ${checkPayload.changed}`);
  lines.push(`- changed_count: ${checkPayload.changed_count}`);
  lines.push(`- state_dir: ${checkPayload.state_dir ?? 'none'}`);
  lines.push('');

  lines.push('## Monitored Files');
  lines.push('');
  lines.push('| File | Changed | Baseline | Expected | Actual | First Diff Line |');
  lines.push('| --- | --- | --- | --- | --- | --- |');

  for (const item of checkPayload.results) {
    const diffLine = item.diff?.line ?? '-';
    lines.push(
      `| ${escapePipe(item.file)} | ${item.changed} | ${escapePipe(item.baseline_source ?? 'unknown')} | ${shortHash(item.expected_hash)} | ${shortHash(item.actual_hash)} | ${diffLine} |`,
    );
  }
  lines.push('');

  lines.push('## Diff Stats');
  lines.push('');

  if (changed.length === 0) {
    lines.push('(no changed files)');
  } else {
    lines.push('| File | Hunks | Additions | Deletions |');
    lines.push('| --- | ---: | ---: | ---: |');

    for (const item of changed) {
      const stats = patchStats.get(item.file) ?? {
        hunks: 0,
        additions: 0,
        deletions: 0,
      };

      lines.push(
        `| ${escapePipe(item.file)} | ${stats.hunks} | ${stats.additions} | ${stats.deletions} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Codex Assessment');
  lines.push('');
  lines.push(`- status: ${assessment.status}`);
  lines.push(`- impact_level: ${assessment.impactLevel}`);
  lines.push(`- requires_project_changes: ${assessment.requiresProjectChanges}`);
  lines.push(`- confidence: ${assessment.confidence}`);
  lines.push('');
  lines.push('### Rationale');
  lines.push('');
  lines.push(assessment.rationale);
  lines.push('');
  lines.push('### Recommended Action');
  lines.push('');
  lines.push(assessment.recommendedAction);
  lines.push('');

  ensureParent(outputPath);
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `report_path=${path.resolve(outputPath)}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${checkPayload.changed}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_count=${checkPayload.changed_count}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `assessment_status=${assessment.status}\n`);
  }

  if (writeSummary) {
    const summaryLines = [
      '# Docs watch report summary',
      '',
      `- report: ${outputPath}`,
      `- changed: ${checkPayload.changed}`,
      `- changed_count: ${checkPayload.changed_count}`,
      `- assessment_status: ${assessment.status}`,
    ];

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n') + '\n');
    } else {
      console.log(summaryLines.join('\n'));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
