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

const manifestPath = getArgValue('--manifest', 'docs/github-documentation/watch-list.json');
const outputPath = getArgValue('--output', null);
const stateDir = getArgValue('--state-dir', null);
const remoteSnapshotsDir = getArgValue('--remote-snapshots-dir', null);
const useLocal = args.includes('--use-local');
const updateManifest = args.includes('--update-manifest') || args.includes('--update-frontmatter');
const writeState = args.includes('--write-state');
const failOnChange = args.includes('--fail-on-change');
const writeSummary = args.includes('--write-summary');
const includeDiffSnippets = args.includes('--include-diff-snippets');

if (writeState && !stateDir) {
  throw new Error('--write-state requires --state-dir');
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

function findFirstDiff(localBody, remoteBody, withSnippets) {
  const localLines = localBody.split('\n');
  const remoteLines = remoteBody.split('\n');
  const max = Math.max(localLines.length, remoteLines.length);
  for (let i = 0; i < max; i += 1) {
    const localLine = localLines[i] ?? '';
    const remoteLine = remoteLines[i] ?? '';
    if (localLine !== remoteLine) {
      return {
        line: i + 1,
        local_line: withSnippets ? truncateLine(localLine) : null,
        remote_line: withSnippets ? truncateLine(remoteLine) : null,
      };
    }
  }
  return null;
}

function resolveStateSnapshotPath(filePath) {
  if (!stateDir) return null;
  return path.join(stateDir, 'snapshots', path.basename(filePath));
}

function readBaselineBody(filePath) {
  const snapshotPath = resolveStateSnapshotPath(filePath);
  if (snapshotPath && fs.existsSync(snapshotPath)) {
    return {
      body: normalizeBody(fs.readFileSync(snapshotPath, 'utf8')),
      source: 'state',
      snapshotPath,
    };
  }

  return {
    body: '',
    source: 'none',
    snapshotPath: null,
  };
}

function writeBody(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalizeBody(body), 'utf8');
}

function loadManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest file not found: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const documents = Array.isArray(raw) ? raw : raw.documents;

  if (!Array.isArray(documents)) {
    throw new Error(`Manifest must contain a documents array: ${filePath}`);
  }

  const normalizedDocs = documents.map((doc, idx) => {
    const file = String(doc.file ?? '').trim();
    const redirectLink = String(doc.redirect_link ?? '').trim();
    const expectedHash = doc.content_sha256 ? String(doc.content_sha256).trim() : null;

    if (!file) {
      throw new Error(`Manifest document at index ${idx} is missing file`);
    }

    if (!redirectLink) {
      throw new Error(`Manifest document at index ${idx} is missing redirect_link`);
    }

    return {
      file,
      markdown_link: doc.markdown_link ? String(doc.markdown_link).trim() : null,
      redirect_link: redirectLink,
      content_sha256: expectedHash,
    };
  });

  normalizedDocs.sort((a, b) => a.file.localeCompare(b.file));

  return {
    root: raw,
    documents: normalizedDocs,
    write(updatedDocuments) {
      const payload = Array.isArray(raw) ? updatedDocuments : { ...raw, documents: updatedDocuments };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    },
  };
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
  const manifest = loadManifest(manifestPath);

  const results = [];
  let changedCount = 0;

  const updatedDocuments = [];

  for (const doc of manifest.documents) {
    const baseline = readBaselineBody(doc.file);
    const remoteBody = useLocal ? baseline.body : normalizeBody(await fetchRemoteBody(doc.redirect_link));
    const actualHash = sha256(remoteBody);
    const changed = doc.content_sha256 !== actualHash;

    if (changed) changedCount += 1;

    const diff = changed && baseline.source !== 'none'
      ? findFirstDiff(baseline.body, remoteBody, includeDiffSnippets)
      : null;

    let remoteSnapshotFile = null;
    if (remoteSnapshotsDir) {
      const remotePath = path.join(remoteSnapshotsDir, path.basename(doc.file));
      writeBody(remotePath, remoteBody);
      remoteSnapshotFile = path.relative(process.cwd(), remotePath);
    }

    if (writeState) {
      const snapshotPath = resolveStateSnapshotPath(doc.file);
      if (!snapshotPath) {
        throw new Error(`Unable to resolve state snapshot path for ${doc.file}`);
      }
      writeBody(snapshotPath, remoteBody);
    }

    const updatedDoc = {
      ...doc,
      content_sha256: updateManifest ? actualHash : doc.content_sha256,
    };

    updatedDocuments.push(updatedDoc);

    results.push({
      file: doc.file,
      markdown_link: doc.markdown_link,
      redirect_link: doc.redirect_link,
      expected_hash: doc.content_sha256,
      actual_hash: actualHash,
      changed,
      baseline_source: baseline.source,
      baseline_snapshot_file: baseline.snapshotPath ? path.relative(process.cwd(), baseline.snapshotPath) : null,
      remote_snapshot_file: remoteSnapshotFile,
      diff,
    });
  }

  if (updateManifest) {
    manifest.write(updatedDocuments);
  }

  const payload = {
    changed: changedCount > 0,
    changed_count: changedCount,
    state_dir: stateDir,
    remote_snapshots_dir: remoteSnapshotsDir,
    manifest_path: manifestPath,
    results,
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
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
      lines.push(`- ${result.file}: ${status} (baseline: ${result.baseline_source})`);
      if (result.changed && result.diff) {
        lines.push(`  - first diff line: ${result.diff.line}`);
        if (includeDiffSnippets) {
          lines.push(`  - local: ${result.diff.local_line}`);
          lines.push(`  - remote: ${result.diff.remote_line}`);
        }
      }
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  } else if (writeSummary) {
    const lines = ['GitHub documentation check:'];
    for (const result of results) {
      const status = result.changed ? 'CHANGED' : 'OK';
      lines.push(`- ${result.file}: ${status} (baseline: ${result.baseline_source})`);
      if (result.changed && result.diff) {
        lines.push(`  - first diff line: ${result.diff.line}`);
        if (includeDiffSnippets) {
          lines.push(`  - local: ${result.diff.local_line}`);
          lines.push(`  - remote: ${result.diff.remote_line}`);
        }
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
