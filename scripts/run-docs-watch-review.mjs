#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function resolveStateDir() {
  return process.env.DOC_WATCH_STATE_DIR || '.tmp/docs-watch/state';
}

function hasSnapshotFiles(stateDir) {
  const snapshotsDir = path.join(stateDir, 'snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    return false;
  }

  const entries = fs.readdirSync(snapshotsDir, { withFileTypes: true });
  return entries.some((entry) => entry.isFile());
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpmScript(scriptName) {
  const result = spawnSync(npmCommand(), ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const stateDir = resolveStateDir();

  console.log(`# Docs watch review entrypoint`);
  console.log(`- state_dir: ${stateDir}`);

  if (!hasSnapshotFiles(stateDir)) {
    console.log(
      '- no private snapshots found; bootstrapping current upstream docs into private state first',
    );
    runNpmScript('sync:github-docs-state');
  } else {
    console.log('- existing private snapshots found; running exact local review');
  }

  runNpmScript('docs-watch:local');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
