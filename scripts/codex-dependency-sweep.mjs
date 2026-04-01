#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const DEFAULTS = {
  baseBranch: "main",
  remote: "origin",
  branchPrefix: "codex/deps-sweep",
  model: "gpt-5-codex",
  reasoning: "medium",
  sandbox: "danger-full-access",
  run: false,
  yes: false,
  showThinking: false,
};

function usage() {
  return `
Usage:
  node scripts/codex-dependency-sweep.mjs [options]

Options:
  --run                      Run codex exec immediately (otherwise print command only)
  --yes                      Skip interactive confirmation when used with --run
  --model <name>             Codex model (default: ${DEFAULTS.model})
  --reasoning <level>        low | medium | high (default: ${DEFAULTS.reasoning})
  --sandbox <mode>           read-only | workspace-write | danger-full-access (default: ${DEFAULTS.sandbox})
  --base <branch>            Base branch to update from (default: ${DEFAULTS.baseBranch})
  --remote <name>            Remote name (default: ${DEFAULTS.remote})
  --branch-prefix <prefix>   Branch prefix for Codex to use (default: ${DEFAULTS.branchPrefix})
  --show-thinking            Show codex stderr (thinking/debug output)
  --help                     Show this help text
`.trim();
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--run":
        options.run = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--show-thinking":
        options.showThinking = true;
        break;
      case "--model":
        i += 1;
        options.model = requireValue(argv[i], arg);
        break;
      case "--reasoning":
        i += 1;
        options.reasoning = requireValue(argv[i], arg);
        break;
      case "--sandbox":
        i += 1;
        options.sandbox = requireValue(argv[i], arg);
        break;
      case "--base":
        i += 1;
        options.baseBranch = requireValue(argv[i], arg);
        break;
      case "--remote":
        i += 1;
        options.remote = requireValue(argv[i], arg);
        break;
      case "--branch-prefix":
        i += 1;
        options.branchPrefix = requireValue(argv[i], arg);
        break;
      case "--help":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["low", "medium", "high"].includes(options.reasoning)) {
    throw new Error(`Invalid --reasoning value: ${options.reasoning}`);
  }

  if (!["read-only", "workspace-write", "danger-full-access"].includes(options.sandbox)) {
    throw new Error(`Invalid --sandbox value: ${options.sandbox}`);
  }

  return options;
}

function requireValue(value, flag) {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => formatShellPart(part))
    .join(" ");
}

function formatShellPart(part) {
  return /\s/.test(part) ? JSON.stringify(part) : part;
}

function run(command, args, { check = true, silent = false } = {}) {
  console.log(`\n$ ${formatCommand(command, args)}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (!silent) {
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
  }

  if (check && result.status !== 0) {
    throw new Error(`Command failed: ${formatCommand(command, args)}`);
  }

  return { status: result.status ?? 1, stdout, stderr };
}

function ensureNodeVersionMatchesNvmrc() {
  const nvmrcPath = path.join(process.cwd(), ".nvmrc");
  const expectedRaw = readFileSync(nvmrcPath, "utf8").trim();
  const expected = expectedRaw.replace(/^v/, "");
  const current = process.version.replace(/^v/, "");
  const expectedPrefix = `${expected}.`;

  if (current !== expected && !current.startsWith(expectedPrefix)) {
    throw new Error(
      `Node version ${current} does not match .nvmrc (${expectedRaw}). Run "nvm use" and try again.`,
    );
  }
}

function ensureCleanWorkingTree() {
  const status = run("git", ["status", "--porcelain"], { silent: true });
  if (status.stdout.trim().length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before running this script.");
  }
}

function parseDependabotPrs(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function buildPrompt({ cwd, options, dependabotPrs, ncuOutput }) {
  const prsBlock =
    dependabotPrs.length > 0
      ? JSON.stringify(dependabotPrs, null, 2)
      : "No open Dependabot PRs were found for this repository.";

  return `
You are performing a Codex-assisted dependency maintenance run for this repository.

Repository path: ${cwd}
Base branch: ${options.baseBranch}
Remote: ${options.remote}
Preferred branch prefix: ${options.branchPrefix}

Pre-collected context:
Open Dependabot PRs:
${prsBlock}

Output of "npx npm-check-updates --enginesNode":
${ncuOutput.trim() || "(no output)"}

Required workflow:
1. Start from ${options.remote}/${options.baseBranch} and create a new branch using prefix "${options.branchPrefix}".
2. Review the Dependabot PR context and ncu output, then attempt to apply dependency updates comprehensively.
3. Explicitly flag any major version updates and assess potential breaking-change risk.
4. If upgrades require code or config changes, make the minimal targeted fixes and explain why they were needed.
5. Validate with:
   - npm run lint
   - npm run typecheck
   - npm run test:all
   - npm run build:all
6. If all checks pass, open a normal PR targeting ${options.baseBranch}.
7. If only partial progress is possible, open a draft PR and clearly document blockers/follow-up.
8. In the PR body, include updated packages, major-version notes, command outcomes, and any manual follow-up.

Constraints:
- Keep diffs focused and minimal.
- Do not merge PRs.
- Use conventional commits.
`.trimStart();
}

async function confirmRun() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await rl.question("Run codex exec now with these settings? [y/N] ");
    return /^y(es)?$/i.test(response.trim());
  } finally {
    rl.close();
  }
}

function runCodex({ options, prompt, promptPath }) {
  const codexArgs = [
    "exec",
    "--skip-git-repo-check",
    "-m",
    options.model,
    "--config",
    `model_reasoning_effort="${options.reasoning}"`,
    "--sandbox",
    options.sandbox,
    "--full-auto",
    "-C",
    process.cwd(),
  ];

  console.log("\nLaunching Codex:");
  console.log(`$ ${formatCommand("codex", codexArgs)} < ${promptPath} 2>/dev/null`);

  const result = spawnSync("codex", codexArgs, {
    cwd: process.cwd(),
    input: prompt,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (options.showThinking || result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }

  if (result.status !== 0) {
    throw new Error("codex exec failed");
  }

  console.log(
    "\nYou can resume this Codex session at any time by saying 'codex resume' or asking me to continue with additional analysis or changes.",
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  ensureNodeVersionMatchesNvmrc();
  run("codex", ["--version"], { silent: true });
  ensureCleanWorkingTree();

  run("git", ["fetch", options.remote]);
  run("git", ["checkout", options.baseBranch]);
  run("git", ["pull", "--ff-only", options.remote, options.baseBranch]);

  const dependabotResult = run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--search",
      "is:pr is:open author:app/dependabot",
      "--json",
      "number,title,headRefName,baseRefName,url",
    ],
    { check: false, silent: true },
  );

  if (dependabotResult.status !== 0) {
    console.warn("Warning: unable to query Dependabot PRs via gh. Continuing without PR context.");
  }

  const ncuResult = run("npx", ["npm-check-updates", "--enginesNode"], { check: true, silent: true });

  const dependabotPrs = parseDependabotPrs(dependabotResult.stdout);
  const prompt = buildPrompt({
    cwd,
    options,
    dependabotPrs,
    ncuOutput: ncuResult.stdout,
  });

  const codexDir = mkdtempSync(path.join(os.tmpdir(), "codex-deps-sweep-"));
  const promptPath = path.join(codexDir, "dependency-sweep.prompt.md");
  writeFileSync(promptPath, prompt, "utf8");

  console.log("\nPrepared Codex dependency sweep prompt:");
  console.log(`- Prompt file: ${promptPath}`);
  console.log(`- Model: ${options.model}`);
  console.log(`- Reasoning: ${options.reasoning}`);
  console.log(`- Sandbox: ${options.sandbox}`);
  console.log("- Full auto: true");
  console.log(`- Open Dependabot PRs detected: ${dependabotPrs.length}`);

  const printableCommand = [
    "codex",
    "exec",
    "--skip-git-repo-check",
    "-m",
    options.model,
    "--config",
    `model_reasoning_effort="${options.reasoning}"`,
    "--sandbox",
    options.sandbox,
    "--full-auto",
    "-C",
    cwd,
    "<",
    promptPath,
    "2>/dev/null",
  ];

  console.log("\nCommand:");
  console.log(`$ ${printableCommand.map((part) => formatShellPart(part)).join(" ")}`);

  if (!options.run) {
    console.log("\nNo Codex execution requested. Re-run with --run when you want to execute it.");
    return;
  }

  if (!options.yes) {
    const approved = await confirmRun();
    if (!approved) {
      console.log("Canceled.");
      return;
    }
  }

  runCodex({ options, prompt, promptPath });
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
