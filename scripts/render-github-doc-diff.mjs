#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);

function getArgValue(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value ?? fallback;
}

const checkPath = getArgValue('--check', 'docs/github-documentation/docs-check.json');
const outputPath = getArgValue('--output', 'docs/github-documentation/docs-diff.md');
const patchOutputPath = getArgValue('--patch-output', 'docs/github-documentation/docs-diff.patch');
const maxDiffLines = Number(getArgValue('--max-diff-lines', '1500'));
const writeSummary = args.includes('--write-summary');

function normalizeBody(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.replace(/\n?$/, '\n');
}

function splitFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return null;
  }
  const frontmatter = match[1];
  const body = text.slice(match[0].length);
  return { frontmatter, body };
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readDocBody(filePath) {
  const text = readText(filePath);
  const parsed = splitFrontmatter(text);
  if (!parsed) {
    throw new Error(`Missing frontmatter in ${filePath}`);
  }
  return normalizeBody(parsed.body);
}

function countDiffStats(diffText) {
  const lines = diffText.split('\n');
  let additions = 0;
  let deletions = 0;
  let hunks = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) hunks += 1;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }

  return { additions, deletions, hunks };
}

function trimDiff(diffText, maxLines) {
  const lines = diffText.split('\n');
  if (lines.length <= maxLines) {
    return { text: diffText, truncated: false };
  }

  const kept = lines.slice(0, maxLines);
  kept.push(`# ... truncated ${lines.length - maxLines} diff line(s)`);
  return { text: kept.join('\n'), truncated: true };
}

function writeTempFile(dir, name, body) {
  const target = path.join(dir, name);
  fs.writeFileSync(target, normalizeBody(body), 'utf8');
  return target;
}

function rewriteDiffHeaders(diffText, fromLabel, toLabel) {
  return diffText
    .replace(/^diff --git a\/.* b\/.*$/m, `diff --git a/${fromLabel} b/${toLabel}`)
    .replace(/^index [0-9a-f]+\.\.[0-9a-f]+ \d+$/m, 'index 0000000..1111111 100644')
    .replace(/^--- a\/.*$/m, `--- a/${fromLabel}`)
    .replace(/^\+\+\+ b\/.*$/m, `+++ b/${toLabel}`);
}

function unifiedDiff(fromLabel, toLabel, localBody, remoteBody) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-doc-diff-'));

  try {
    const localPath = writeTempFile(tmpDir, 'local.md', localBody);
    const remotePath = writeTempFile(tmpDir, 'remote.md', remoteBody);

    const result = spawnSync(
      'git',
      ['--no-pager', 'diff', '--no-index', '--unified=5', '--', localPath, remotePath],
      { encoding: 'utf8' },
    );

    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git diff failed (${result.status}): ${result.stderr || result.stdout}`);
    }

    const raw = result.stdout || '';
    if (!raw.trim()) return '';
    return rewriteDiffHeaders(raw, fromLabel, toLabel);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readRemoteSnapshot(item) {
  if (!item.remote_snapshot_file) {
    throw new Error(`Missing remote_snapshot_file for ${item.file}`);
  }
  const absolute = path.resolve(item.remote_snapshot_file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Remote snapshot not found for ${item.file}: ${absolute}`);
  }
  return normalizeBody(readText(absolute));
}

function readBaselineBody(item) {
  if (item.baseline_snapshot_file) {
    const absolute = path.resolve(item.baseline_snapshot_file);
    if (fs.existsSync(absolute)) {
      return normalizeBody(readText(absolute));
    }
  }

  const docPath = path.resolve(item.file);
  if (!fs.existsSync(docPath)) {
    return '';
  }

  return readDocBody(docPath);
}

async function main() {
  const payload = JSON.parse(readText(checkPath));
  const changed = payload.results.filter((result) => result.changed);

  const markdownLines = [
    '# GitHub Documentation Diff Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    `Changed files: ${changed.length}`,
    '',
  ];

  const patchBlocks = [];
  const summaries = [];

  for (const item of changed) {
    if (item.baseline_source === 'none') {
      summaries.push({ file: item.file, additions: 0, deletions: 0, hunks: 0, truncated: false });
      markdownLines.push(`## ${item.file}`);
      markdownLines.push('');
      markdownLines.push('No baseline snapshot is available yet, so a textual diff cannot be generated for this run.');
      markdownLines.push('');
      continue;
    }

    const baselineBody = readBaselineBody(item);
    const remoteBody = readRemoteSnapshot(item);
    const diffText = unifiedDiff(item.file, `${item.file} (remote)`, baselineBody, remoteBody);

    if (!diffText.trim()) {
      summaries.push({ file: item.file, additions: 0, deletions: 0, hunks: 0, truncated: false });
      markdownLines.push(`## ${item.file}`);
      markdownLines.push('');
      markdownLines.push('No textual diff generated (baseline already matches remote snapshot).');
      markdownLines.push('');
      continue;
    }

    const stats = countDiffStats(diffText);
    const trimmed = trimDiff(diffText, maxDiffLines);

    patchBlocks.push(diffText);
    summaries.push({
      file: item.file,
      additions: stats.additions,
      deletions: stats.deletions,
      hunks: stats.hunks,
      truncated: trimmed.truncated,
    });

    markdownLines.push(`## ${item.file}`);
    markdownLines.push('');
    markdownLines.push(`- redirect-link: ${item.redirect_link}`);
    markdownLines.push(`- expected hash: ${item.expected_hash ?? 'missing'}`);
    markdownLines.push(`- actual hash: ${item.actual_hash}`);
    markdownLines.push(`- diff stats: +${stats.additions} / -${stats.deletions} across ${stats.hunks} hunk(s)`);
    markdownLines.push('');
    markdownLines.push('<details>');
    markdownLines.push(`<summary>Unified diff for ${item.file}</summary>`);
    markdownLines.push('');
    markdownLines.push('```diff');
    markdownLines.push(trimmed.text);
    markdownLines.push('```');
    markdownLines.push('');
    markdownLines.push('</details>');
    markdownLines.push('');
  }

  if (changed.length === 0) {
    markdownLines.push('No changes detected.');
  }

  ensureParent(outputPath);
  ensureParent(patchOutputPath);

  fs.writeFileSync(outputPath, markdownLines.join('\n'), 'utf8');
  fs.writeFileSync(patchOutputPath, patchBlocks.join('\n\n'), 'utf8');

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `diff_report=${path.resolve(outputPath)}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `diff_patch=${path.resolve(patchOutputPath)}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `files_with_diff=${summaries.filter((s) => s.hunks > 0).length}\n`);
  }

  if (writeSummary) {
    const summaryLines = ['# Docs diff summary', ''];
    if (summaries.length === 0) {
      summaryLines.push('- No changed files');
    } else {
      for (const summary of summaries) {
        summaryLines.push(
          `- ${summary.file}: +${summary.additions} / -${summary.deletions} across ${summary.hunks} hunk(s)${summary.truncated ? ' (truncated in markdown report)' : ''}`,
        );
      }
    }

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
