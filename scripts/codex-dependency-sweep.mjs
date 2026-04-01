#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const DEFAULTS = {
  baseBranch: "main",
  remote: "origin",
  branchPrefix: "codex/deps-sweep",
  worktreeRoot: path.join(os.tmpdir(), "codex-deps-sweep-worktrees"),
  model: "gpt-5-codex",
  reasoning: "medium",
  sandbox: "danger-full-access",
  isolated: false,
  keepWorktree: false,
  run: false,
  yes: false,
  auto: false,
  showThinking: false,
};

function usage() {
  return `
Usage:
  node scripts/codex-dependency-sweep.mjs [options]

Options:
  --run                      Run codex exec immediately (otherwise print command only)
  --yes                      Skip interactive confirmation when used with --run
  --auto                     Fully unattended run (equivalent to --run --yes --isolated)
  --isolated                 Run in a dedicated git worktree (recommended for unattended runs)
  --keep-worktree            Do not remove worktree after successful run
  --worktree-root <dir>      Parent directory for isolated worktrees (default: ${DEFAULTS.worktreeRoot})
  --model <name>             Codex model (default: ${DEFAULTS.model})
  --reasoning <level>        low | medium | high (default: ${DEFAULTS.reasoning})
  --sandbox <mode>           read-only | workspace-write | danger-full-access (default: ${DEFAULTS.sandbox})
  --base <branch>            Base branch to update from (default: ${DEFAULTS.baseBranch})
  --remote <name>            Remote name (default: ${DEFAULTS.remote})
  --branch-prefix <prefix>   Branch prefix for update branches (default: ${DEFAULTS.branchPrefix})
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
      case "--auto":
        options.auto = true;
        break;
      case "--isolated":
        options.isolated = true;
        break;
      case "--keep-worktree":
        options.keepWorktree = true;
        break;
      case "--show-thinking":
        options.showThinking = true;
        break;
      case "--worktree-root":
        i += 1;
        options.worktreeRoot = requireValue(argv[i], arg);
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

  if (options.auto) {
    options.run = true;
    options.yes = true;
    options.isolated = true;
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

function formatShellPart(part) {
  return /\s/.test(part) ? JSON.stringify(part) : part;
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => formatShellPart(part)).join(" ");
}

function run(command, args, { check = true, silent = false, cwd = process.cwd() } = {}) {
  console.log(`\n$ (cd ${formatShellPart(cwd)} && ${formatCommand(command, args)})`);
  const result = spawnSync(command, args, {
    cwd,
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

function parseJsonObject(raw, fallback = {}) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseDependabotPrs(raw) {
  const parsed = parseJsonObject(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function ensureNodeVersionMatchesNvmrc(repoRoot) {
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
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

function ensureCleanWorkingTree(repoRoot) {
  const status = run("git", ["status", "--porcelain"], { silent: true, cwd: repoRoot });
  if (status.stdout.trim().length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before running this script.");
  }
}

function ensureCodexAuthenticated(repoRoot) {
  const result = run("codex", ["login", "status"], {
    silent: true,
    check: false,
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    throw new Error("Codex CLI is not authenticated. Run `codex login` and try again.");
  }
}

function ensureGhAuthenticated(repoRoot) {
  const result = run("gh", ["auth", "status"], {
    silent: true,
    check: false,
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    throw new Error("GitHub CLI is not authenticated. Run `gh auth login` and try again.");
  }
}

function ensureGitIdentityConfigured(repoRoot) {
  const name = run("git", ["config", "--get", "user.name"], {
    silent: true,
    check: false,
    cwd: repoRoot,
  }).stdout.trim();
  const email = run("git", ["config", "--get", "user.email"], {
    silent: true,
    check: false,
    cwd: repoRoot,
  }).stdout.trim();

  if (!name || !email) {
    throw new Error(
      "Git author identity is not configured. Set `git config --global user.name` and `git config --global user.email`.",
    );
  }
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function prepareIsolatedWorktree({ repoRoot, options }) {
  const stamp = nowStamp();
  const branchName = `${options.branchPrefix}-${stamp}`;
  const baseRef = `${options.remote}/${options.baseBranch}`;
  const repoName = sanitizeSegment(path.basename(repoRoot));
  const root = path.resolve(repoRoot, options.worktreeRoot);
  mkdirSync(root, { recursive: true });
  const worktreePath = path.join(root, `${repoName}-${stamp}`);

  run("git", ["worktree", "add", "-b", branchName, worktreePath, baseRef], { cwd: repoRoot });

  return { worktreePath, branchName };
}

function cleanupWorktree({ repoRoot, worktreePath }) {
  run("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoRoot,
    check: false,
    silent: true,
  });
  run("git", ["worktree", "prune"], { cwd: repoRoot, check: false, silent: true });
}

function buildPrompt({
  repoRoot,
  runCwd,
  options,
  dependabotPrs,
  ncuSummary,
  ncuUpgraded,
  mode,
  preparedBranch,
}) {
  const prsBlock =
    dependabotPrs.length > 0
      ? JSON.stringify(dependabotPrs, null, 2)
      : "No open Dependabot PRs were found for this repository.";

  const upgradedBlock = JSON.stringify(ncuUpgraded, null, 2);
  const hasNcuUpdates = Object.keys(ncuUpgraded).length > 0;

  return `
You are performing a Codex-assisted dependency maintenance run for this repository.

Repository root: ${repoRoot}
Execution directory: ${runCwd}
Base branch: ${options.baseBranch}
Remote: ${options.remote}
Requested branch prefix: ${options.branchPrefix}
Execution mode: ${mode}
Prepared branch (if provided): ${preparedBranch ?? "(none)"}

Pre-collected context:
Open Dependabot PRs:
${prsBlock}

Output of "npx npm-check-updates --enginesNode":
${ncuSummary.trim() || "(no output)"}

Output of "npx npm-check-updates --enginesNode --jsonUpgraded":
${upgradedBlock}

Required workflow:
1. If execution mode is "isolated-worktree", stay in the prepared branch and directory; do not switch back to ${options.baseBranch}.
2. Review open Dependabot PR context plus ncu results, and attempt to apply all actionable dependency updates.
3. Explicitly flag any major version updates and assess breaking-change risk.
4. If upgrades require code or config changes, make the minimal targeted fixes and explain why they were needed.
5. Validate with:
   - npm run lint
   - npm run typecheck
   - npm run test:all
   - npm run build:all
6. If everything is green and changes are valid, open a normal PR targeting ${options.baseBranch}.
7. If partial progress is made but there are hard blockers, open a draft PR documenting blockers and follow-up.
8. If no dependency updates are needed (${hasNcuUpdates ? "ncu reports updates present" : "ncu reports no updates"}) and there is no meaningful dependency work to apply from Dependabot context, do not open a PR.

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

function runCodex({ options, prompt, promptPath, runCwd }) {
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
    runCwd,
  ];

  console.log("\nLaunching Codex:");
  console.log(`$ ${formatCommand("codex", codexArgs)} < ${promptPath} 2>/dev/null`);

  const result = spawnSync("codex", codexArgs, {
    cwd: runCwd,
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
  const repoRoot = process.cwd();

  ensureNodeVersionMatchesNvmrc(repoRoot);
  run("codex", ["--version"], { silent: true, cwd: repoRoot });
  ensureCodexAuthenticated(repoRoot);
  ensureGhAuthenticated(repoRoot);
  ensureGitIdentityConfigured(repoRoot);
  run("git", ["fetch", options.remote], { cwd: repoRoot });

  let runCwd = repoRoot;
  let preparedBranch = null;
  let mode = "in-place";
  let createdWorktree = false;
  let worktreePath = null;

  if (options.isolated) {
    mode = "isolated-worktree";
    const prepared = prepareIsolatedWorktree({ repoRoot, options });
    runCwd = prepared.worktreePath;
    preparedBranch = prepared.branchName;
    createdWorktree = true;
    worktreePath = prepared.worktreePath;
  } else {
    ensureCleanWorkingTree(repoRoot);
    run("git", ["checkout", options.baseBranch], { cwd: repoRoot });
    run("git", ["pull", "--ff-only", options.remote, options.baseBranch], { cwd: repoRoot });
  }

  try {
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
      { check: false, silent: true, cwd: repoRoot },
    );

    if (dependabotResult.status !== 0) {
      console.warn("Warning: unable to query Dependabot PRs via gh. Continuing without PR context.");
    }

    const ncuSummaryResult = run(
      "npx",
      ["npm-check-updates", "--enginesNode"],
      { check: true, silent: true, cwd: runCwd },
    );
    const ncuJsonResult = run(
      "npx",
      ["npm-check-updates", "--enginesNode", "--jsonUpgraded"],
      { check: true, silent: true, cwd: runCwd },
    );

    const dependabotPrs = parseDependabotPrs(dependabotResult.stdout);
    const ncuUpgraded = parseJsonObject(ncuJsonResult.stdout, {});
    const hasNcuUpdates = Object.keys(ncuUpgraded).length > 0;
    const hasDependabotContext = dependabotPrs.length > 0;

    if (!hasNcuUpdates && !hasDependabotContext) {
      console.log("\nNo dependency updates detected (ncu empty, no open Dependabot PRs). Nothing to do.");
      return;
    }

    const prompt = buildPrompt({
      repoRoot,
      runCwd,
      options,
      dependabotPrs,
      ncuSummary: ncuSummaryResult.stdout,
      ncuUpgraded,
      mode,
      preparedBranch,
    });

    const promptDir = mkdtempSync(path.join(os.tmpdir(), "codex-deps-sweep-prompt-"));
    const promptPath = path.join(promptDir, "dependency-sweep.prompt.md");
    writeFileSync(promptPath, prompt, "utf8");

    console.log("\nPrepared Codex dependency sweep prompt:");
    console.log(`- Prompt file: ${promptPath}`);
    console.log(`- Model: ${options.model}`);
    console.log(`- Reasoning: ${options.reasoning}`);
    console.log(`- Sandbox: ${options.sandbox}`);
    console.log("- Full auto: true");
    console.log(`- Execution mode: ${mode}`);
    console.log(`- Working directory: ${runCwd}`);
    if (preparedBranch) {
      console.log(`- Prepared branch: ${preparedBranch}`);
    }
    console.log(`- Open Dependabot PRs detected: ${dependabotPrs.length}`);
    console.log(`- ncu upgraded package count: ${Object.keys(ncuUpgraded).length}`);

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
      runCwd,
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

    runCodex({ options, prompt, promptPath, runCwd });
  } finally {
    if (createdWorktree && worktreePath) {
      if (!options.keepWorktree && options.run) {
        cleanupWorktree({ repoRoot, worktreePath });
        console.log(`Cleaned up worktree: ${worktreePath}`);
      } else {
        console.log(`Worktree preserved: ${worktreePath}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
