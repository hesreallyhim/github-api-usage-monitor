#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const args = process.argv.slice(2);

function getArgValue(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value ?? fallback;
}

const docsDir = getArgValue('--dir', 'docs/github-documentation');
const outputPath = getArgValue('--output', null);
const useLocal = args.includes('--use-local');
const updateFrontmatter = args.includes('--update-frontmatter');
const failOnChange = args.includes('--fail-on-change');
const writeSummary = args.includes('--write-summary');

function splitFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!match) {
    return null;
  }
  const frontmatter = match[1];
  const body = text.slice(match[0].length);
  return { frontmatter, body };
}

function parseFrontmatterMap(frontmatter) {
  const map = new Map();
  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }
  return map;
}

function normalizeBody(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.replace(/\n?$/, '\n');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function truncateLine(line, maxLength = 200) {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength)}…`;
}

function findFirstDiff(localBody, remoteBody) {
  const localLines = localBody.split('\n');
  const remoteLines = remoteBody.split('\n');
  const max = Math.max(localLines.length, remoteLines.length);
  for (let i = 0; i < max; i += 1) {
    const localLine = localLines[i] ?? '';
    const remoteLine = remoteLines[i] ?? '';
    if (localLine !== remoteLine) {
      return {
        line: i + 1,
        local_line: truncateLine(localLine),
        remote_line: truncateLine(remoteLine),
      };
    }
  }
  return null;
}

function updateFrontmatterHash(originalText, newHash) {
  const parsed = splitFrontmatter(originalText);
  if (!parsed) {
    throw new Error('Missing frontmatter');
  }
  const lines = parsed.frontmatter.split(/\r?\n/);
  const existingIndex = lines.findIndex((line) => line.trim().startsWith('content-sha256:'));
  const newLine = `content-sha256: ${newHash}`;

  if (existingIndex !== -1) {
    lines[existingIndex] = newLine;
  } else {
    const redirectIndex = lines.findIndex((line) => line.trim().startsWith('redirect-link:'));
    if (redirectIndex !== -1) {
      lines.splice(redirectIndex + 1, 0, newLine);
    } else {
      lines.push(newLine);
    }
  }

  return `---\n${lines.join('\n')}\n---\n${parsed.body}`;
}

async function fetchRemoteBody(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'github-api-usage-monitor-doc-check',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function main() {
  const entries = fs
    .readdirSync(docsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.join(docsDir, file));

  const results = [];
  let changedCount = 0;

  for (const file of entries) {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = splitFrontmatter(text);
    if (!parsed) {
      throw new Error(`Missing frontmatter in ${file}`);
    }

    const frontmatterMap = parseFrontmatterMap(parsed.frontmatter);
    const redirectLink = frontmatterMap.get('redirect-link');
    const expectedHash = frontmatterMap.get('content-sha256') ?? null;

    if (!redirectLink) {
      throw new Error(`Missing redirect-link in ${file}`);
    }

    const localBody = normalizeBody(parsed.body);
    const remoteBody = useLocal ? localBody : normalizeBody(await fetchRemoteBody(redirectLink));
    const actualHash = sha256(remoteBody);
    const changed = expectedHash !== actualHash;
    const diff = changed ? findFirstDiff(localBody, remoteBody) : null;

    if (changed) changedCount += 1;

    if (updateFrontmatter) {
      const updated = updateFrontmatterHash(text, actualHash);
      fs.writeFileSync(file, updated, 'utf8');
    }

    results.push({
      file: path.relative(process.cwd(), file),
      redirect_link: redirectLink,
      expected_hash: expectedHash,
      actual_hash: actualHash,
      changed,
      diff,
    });
  }

  const payload = {
    changed: changedCount > 0,
    changed_count: changedCount,
    results,
  };

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${payload.changed}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_count=${payload.changed_count}\n`);
  }

  if (writeSummary && process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['# GitHub documentation check', ''];
    for (const result of results) {
      const status = result.changed ? 'CHANGED' : 'OK';
      lines.push(`- ${result.file}: ${status}`);
      if (result.changed && result.diff) {
        lines.push(`  - first diff line: ${result.diff.line}`);
        lines.push(`  - local: ${result.diff.local_line}`);
        lines.push(`  - remote: ${result.diff.remote_line}`);
      }
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  } else if (writeSummary) {
    const lines = ['GitHub documentation check:'];
    for (const result of results) {
      const status = result.changed ? 'CHANGED' : 'OK';
      lines.push(`- ${result.file}: ${status}`);
      if (result.changed && result.diff) {
        lines.push(`  - first diff line: ${result.diff.line}`);
        lines.push(`  - local: ${result.diff.local_line}`);
        lines.push(`  - remote: ${result.diff.remote_line}`);
      }
    }
    console.log(lines.join('\n'));
  }

  if (failOnChange && payload.changed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
