#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const DEFAULTS = {
  model: "gpt-5-codex",
  reasoning: "medium",
  sandbox: "danger-full-access",
  scope: "issues-and-updates",
  remote: "origin",
  branchPrefix: "codex/deps-fleet",
  worktreeRoot: path.join(os.tmpdir(), "codex-deps-fleet-worktrees"),
  keepWorktree: false,
  dryRun: false,
  yes: false,
  stopOnError: false,
  showThinking: false,
  maxRepos: null,
};

function usage() {
  return `
Usage:
  node codex-dependency-fleet.mjs [options]

Options:
  --config <path>            Path to fleet config JSON (see dependency-fleet.config.example.json)
  --repo <path>              Repository path (repeatable)
  --scope <mode>             prs | issues-and-updates (default: ${DEFAULTS.scope})
  --model <name>             Codex model (default: ${DEFAULTS.model})
  --reasoning <level>        low | medium | high (default: ${DEFAULTS.reasoning})
  --sandbox <mode>           read-only | workspace-write | danger-full-access (default: ${DEFAULTS.sandbox})
  --remote <name>            Git remote name (default: ${DEFAULTS.remote})
  --branch-prefix <prefix>   Branch prefix for generated branches (default: ${DEFAULTS.branchPrefix})
  --worktree-root <dir>      Parent directory for isolated worktrees (default: ${DEFAULTS.worktreeRoot})
  --max-repos <n>            Process at most N repos from config/list
  --keep-worktree            Preserve worktrees after each run
  --dry-run                  Prepare prompts and commands only (do not run Codex)
  --yes                      Skip interactive confirmation
  --stop-on-error            Stop after first repo failure
  --show-thinking            Show codex stderr output
  --help                     Show this help text
`.trim();
}

function requireValue(value, flag) {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, repos: [], configPath: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--config":
        i += 1;
        options.configPath = requireValue(argv[i], arg);
        break;
      case "--repo":
        i += 1;
        options.repos.push(requireValue(argv[i], arg));
        break;
      case "--scope":
        i += 1;
        options.scope = requireValue(argv[i], arg);
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
      case "--remote":
        i += 1;
        options.remote = requireValue(argv[i], arg);
        break;
      case "--branch-prefix":
        i += 1;
        options.branchPrefix = requireValue(argv[i], arg);
        break;
      case "--worktree-root":
        i += 1;
        options.worktreeRoot = requireValue(argv[i], arg);
        break;
      case "--max-repos":
        i += 1;
        options.maxRepos = Number.parseInt(requireValue(argv[i], arg), 10);
        break;
      case "--keep-worktree":
        options.keepWorktree = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
        options.yes = true;
        break;
      case "--stop-on-error":
        options.stopOnError = true;
        break;
      case "--show-thinking":
        options.showThinking = true;
        break;
      case "--help":
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["prs", "issues-and-updates"].includes(options.scope)) {
    throw new Error(`Invalid --scope: ${options.scope}`);
  }
  if (!["low", "medium", "high"].includes(options.reasoning)) {
    throw new Error(`Invalid --reasoning: ${options.reasoning}`);
  }
  if (!["read-only", "workspace-write", "danger-full-access"].includes(options.sandbox)) {
    throw new Error(`Invalid --sandbox: ${options.sandbox}`);
  }
  if (options.maxRepos !== null && (!Number.isFinite(options.maxRepos) || options.maxRepos < 1)) {
    throw new Error(`Invalid --max-repos value: ${options.maxRepos}`);
  }
  if (!options.configPath && options.repos.length === 0) {
    throw new Error("Provide at least one --repo path or a --config file.");
  }

  return options;
}

function formatShellPart(part) {
  return /\s/.test(part) ? JSON.stringify(part) : part;
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => formatShellPart(part)).join(" ");
}

function run(command, args, { cwd = process.cwd(), check = true, silent = false, input = undefined } = {}) {
  if (!silent) {
    console.log(`\n$ (cd ${formatShellPart(cwd)} && ${formatCommand(command, args)})`);
  }

  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
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

function safeJsonParse(raw, fallback) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed;
  } catch {
    return fallback;
  }
}

function slugify(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function ensureCommandAvailable(command) {
  const result = run(command, ["--version"], { check: false, silent: true });
  if (result.status !== 0) {
    throw new Error(`Required command not found or not runnable: ${command}`);
  }
}

function ensureCodexAuthenticated() {
  const result = run("codex", ["login", "status"], { check: false, silent: true });
  if (result.status !== 0) {
    throw new Error("Codex CLI not authenticated. Run `codex login`.");
  }
}

function ensureGhAuthenticated() {
  const result = run("gh", ["auth", "status"], { check: false, silent: true });
  if (result.status !== 0) {
    throw new Error("GitHub CLI not authenticated. Run `gh auth login`.");
  }
}

function resolveFleetConfig(configPath) {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid JSON config: ${absolutePath}`);
  }

  const defaults = typeof parsed.defaults === "object" && parsed.defaults ? parsed.defaults : {};
  const repos = Array.isArray(parsed.repos) ? parsed.repos : [];

  return { absolutePath, defaults, repos };
}

function resolveTargets(options) {
  const rawTargets = [];
  const configDefaults = {};

  if (options.configPath) {
    const config = resolveFleetConfig(options.configPath);
    Object.assign(configDefaults, config.defaults);
    for (const entry of config.repos) {
      if (typeof entry === "string") {
        rawTargets.push({ path: entry });
      } else if (entry && typeof entry === "object") {
        rawTargets.push(entry);
      }
    }
  }

  for (const repoPath of options.repos) {
    rawTargets.push({ path: repoPath });
  }

  const targets = rawTargets
    .filter((entry) => entry && typeof entry.path === "string" && entry.path.trim().length > 0)
    .map((entry) => {
      const repoPath = path.resolve(process.cwd(), entry.path);
      return {
        path: repoPath,
        scope: entry.scope || options.scope || configDefaults.scope || DEFAULTS.scope,
        baseBranch: entry.baseBranch || configDefaults.baseBranch || null,
      };
    });

  if (targets.length === 0) {
    throw new Error("No valid repositories found in inputs.");
  }

  const deduped = [];
  const seen = new Set();
  for (const target of targets) {
    if (seen.has(target.path)) {
      continue;
    }
    seen.add(target.path);
    deduped.push(target);
  }

  if (options.maxRepos !== null) {
    return deduped.slice(0, options.maxRepos);
  }
  return deduped;
}

function ensureGitRepo(repoPath) {
  const result = run("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoPath,
    check: false,
    silent: true,
  });
  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

function detectBaseBranch(repoPath, remote, fallback) {
  if (fallback) {
    return fallback;
  }

  const symbolic = run("git", ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], {
    cwd: repoPath,
    check: false,
    silent: true,
  });
  if (symbolic.status === 0) {
    const value = symbolic.stdout.trim();
    const prefix = `${remote}/`;
    if (value.startsWith(prefix) && value.length > prefix.length) {
      return value.slice(prefix.length);
    }
  }
  return "main";
}

function detectRepoFullName(repoPath) {
  const result = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    cwd: repoPath,
    check: false,
    silent: true,
  });
  if (result.status !== 0) {
    return null;
  }
  const name = result.stdout.trim();
  return name.length > 0 ? name : null;
}

function detectEcosystems(repoPath) {
  const ecosystems = [];
  const has = (file) => existsSync(path.join(repoPath, file));

  if (has("package.json")) ecosystems.push("node");
  if (has("pyproject.toml") || has("requirements.txt") || has("Pipfile")) ecosystems.push("python");
  if (has("Cargo.toml")) ecosystems.push("rust");
  if (has("go.mod")) ecosystems.push("go");
  if (has("Gemfile")) ecosystems.push("ruby");
  if (has("composer.json")) ecosystems.push("php");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) ecosystems.push("java");

  if (has("requirements")) {
    ecosystems.push("python");
  } else {
    try {
      const files = readdirSync(repoPath);
      if (files.some((name) => /^requirements.*\.txt$/i.test(name))) {
        ecosystems.push("python");
      }
    } catch {
      // Ignore directory-read errors and continue.
    }
  }

  return Array.from(new Set(ecosystems));
}

function collectDependabotContext(repoPath, repoFullName, scope) {
  const context = {
    prs: [],
    issues: [],
    alerts: [],
    alertsError: null,
  };

  const prsResult = run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--search",
      "is:pr is:open author:app/dependabot",
      "--json",
      "number,title,url,headRefName,baseRefName",
    ],
    { cwd: repoPath, check: false, silent: true },
  );
  if (prsResult.status === 0) {
    const parsed = safeJsonParse(prsResult.stdout, []);
    if (Array.isArray(parsed)) {
      context.prs = parsed;
    }
  }

  if (scope === "issues-and-updates") {
    const issuesResult = run(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--search",
        "is:issue is:open author:app/dependabot",
        "--json",
        "number,title,url",
      ],
      { cwd: repoPath, check: false, silent: true },
    );
    if (issuesResult.status === 0) {
      const parsed = safeJsonParse(issuesResult.stdout, []);
      if (Array.isArray(parsed)) {
        context.issues = parsed;
      }
    }

    if (repoFullName) {
      const alertsResult = run(
        "gh",
        [
          "api",
          "-H",
          "Accept: application/vnd.github+json",
          `/repos/${repoFullName}/dependabot/alerts?state=open&per_page=100`,
        ],
        { cwd: repoPath, check: false, silent: true },
      );
      if (alertsResult.status === 0) {
        const parsed = safeJsonParse(alertsResult.stdout, []);
        if (Array.isArray(parsed)) {
          context.alerts = parsed.slice(0, 25).map((alert) => ({
            number: alert.number,
            state: alert.state,
            severity: alert?.security_advisory?.severity ?? null,
            package: alert?.dependency?.package?.name ?? null,
            manifest: alert?.dependency?.manifest_path ?? null,
            summary: alert?.security_advisory?.summary ?? null,
            html_url: alert?.html_url ?? null,
          }));
        }
      } else {
        context.alertsError = "Dependabot alerts endpoint unavailable (auth scope may be missing).";
      }
    }
  }

  return context;
}

function shouldRunCodex(target, context, ecosystems) {
  if (target.scope === "prs") {
    return context.prs.length > 0;
  }
  if (context.prs.length > 0 || context.issues.length > 0 || context.alerts.length > 0) {
    return true;
  }
  return ecosystems.length > 0;
}

function prepareWorktree({ repoPath, remote, baseBranch, branchPrefix, worktreeRoot, repoSlug }) {
  const stamp = nowStamp();
  const branchName = `${branchPrefix}/${repoSlug}-${stamp}`;
  const baseRef = `${remote}/${baseBranch}`;
  const root = path.resolve(repoPath, worktreeRoot);
  mkdirSync(root, { recursive: true });
  const worktreePath = path.join(root, `${repoSlug}-${stamp}`);
  run("git", ["worktree", "add", "-b", branchName, worktreePath, baseRef], { cwd: repoPath });
  return { worktreePath, branchName };
}

function cleanupWorktree(repoPath, worktreePath) {
  run("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: repoPath,
    check: false,
    silent: true,
  });
  run("git", ["worktree", "prune"], { cwd: repoPath, check: false, silent: true });
}

function buildPrompt({ repoPath, runCwd, target, baseBranch, branchName, repoFullName, ecosystems, context }) {
  const scopeText =
    target.scope === "prs"
      ? "Resolve open Dependabot PR-related dependency work only."
      : "Resolve open Dependabot PRs/issues/alerts and ensure dependencies are up to date.";

  return `
You are running a dependency-maintenance pass for this repository.

Repository path: ${repoPath}
Execution directory (isolated worktree): ${runCwd}
Repository name: ${repoFullName ?? "(unknown)"}
Base branch: ${baseBranch}
Prepared branch: ${branchName}
Requested scope: ${target.scope}
Detected ecosystems: ${ecosystems.length > 0 ? ecosystems.join(", ") : "unknown"}

Dependabot context (pre-collected):
- Open PRs: ${JSON.stringify(context.prs, null, 2)}
- Open issues: ${JSON.stringify(context.issues, null, 2)}
- Open alerts: ${JSON.stringify(context.alerts, null, 2)}
- Alert retrieval note: ${context.alertsError ?? "none"}

Primary objective:
${scopeText}

Required process:
1. Stay in this prepared worktree/branch. Do not switch away from ${branchName}.
2. Review dependency manifests and apply safe updates using repo-native tooling.
3. Explicitly flag major version updates and breaking-change risks.
4. When updates require code/config changes, implement the minimal targeted fixes.
5. Run verification commands relevant to this repo. Prefer this order if available:
   - npm run lint
   - npm run typecheck
   - npm run test:all
   - npm run build:all
   If these are not applicable, run equivalent project checks.
6. If no dependency changes are needed, do not open a PR.
7. If checks pass, open a normal PR targeting ${baseBranch}.
8. If hard blockers remain but useful progress exists, open a draft PR with blockers and next steps.
9. Do not merge PRs.

Output expectations:
- Keep diffs minimal and focused.
- Include a concise PR body with updated packages, major-risk notes, command outcomes, and follow-up items.
`.trimStart();
}

function runCodex({ options, runCwd, prompt, promptPath }) {
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

  console.log(`\n$ ${formatCommand("codex", codexArgs)} < ${promptPath} 2>/dev/null`);

  const result = spawnSync("codex", codexArgs, {
    cwd: runCwd,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
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
}

async function confirmStart(repoCount, dryRun) {
  if (dryRun) {
    return true;
  }

  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await rl.question(`Run dependency fleet on ${repoCount} repos now? [y/N] `);
    return /^y(es)?$/i.test(response.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  ensureCommandAvailable("git");
  ensureCommandAvailable("gh");
  ensureCommandAvailable("codex");
  ensureCodexAuthenticated();
  ensureGhAuthenticated();

  const targets = resolveTargets(options);
  console.log(`Loaded ${targets.length} repository target(s).`);

  if (!options.yes) {
    const approved = await confirmStart(targets.length, options.dryRun);
    if (!approved) {
      throw new Error("Canceled. Re-run with --yes to skip confirmation.");
    }
  }

  const results = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const label = `[${index + 1}/${targets.length}] ${target.path}`;
    console.log(`\n=== ${label} ===`);

    try {
      ensureGitRepo(target.path);
      run("git", ["fetch", options.remote], { cwd: target.path });
      const baseBranch = detectBaseBranch(target.path, options.remote, target.baseBranch);
      const repoFullName = detectRepoFullName(target.path);
      const ecosystems = detectEcosystems(target.path);
      const context = collectDependabotContext(target.path, repoFullName, target.scope);

      if (!shouldRunCodex(target, context, ecosystems)) {
        console.log("No actionable dependency context found. Skipping.");
        results.push({ repo: target.path, status: "skipped", detail: "no actionable updates" });
        continue;
      }

      const repoSlug = slugify(repoFullName ?? path.basename(target.path));
      const prepared = prepareWorktree({
        repoPath: target.path,
        remote: options.remote,
        baseBranch,
        branchPrefix: options.branchPrefix,
        worktreeRoot: options.worktreeRoot,
        repoSlug,
      });

      let cleanedUp = false;
      try {
        const prompt = buildPrompt({
          repoPath: target.path,
          runCwd: prepared.worktreePath,
          target,
          baseBranch,
          branchName: prepared.branchName,
          repoFullName,
          ecosystems,
          context,
        });

        const promptDir = mkdtempSync(path.join(os.tmpdir(), "codex-deps-fleet-prompt-"));
        const promptPath = path.join(promptDir, `${repoSlug}.prompt.md`);
        writeFileSync(promptPath, prompt, "utf8");

        console.log(`Prepared prompt: ${promptPath}`);
        if (options.dryRun) {
          console.log("Dry-run mode enabled; Codex execution skipped.");
          results.push({
            repo: target.path,
            status: "prepared",
            detail: `worktree ${prepared.worktreePath}, branch ${prepared.branchName}`,
          });
          continue;
        }

        runCodex({
          options,
          runCwd: prepared.worktreePath,
          prompt,
          promptPath,
        });

        results.push({ repo: target.path, status: "ok", detail: `branch ${prepared.branchName}` });
      } finally {
        if (!options.keepWorktree && !options.dryRun) {
          cleanupWorktree(target.path, prepared.worktreePath);
          cleanedUp = true;
          console.log(`Cleaned up worktree: ${prepared.worktreePath}`);
        } else {
          console.log(`Worktree preserved: ${prepared.worktreePath}`);
        }
      }

      if (!cleanedUp && !options.keepWorktree && options.dryRun) {
        // Keep worktree in dry-run so commands/prompts can be inspected.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Repo failed: ${message}`);
      results.push({ repo: target.path, status: "failed", detail: message });
      if (options.stopOnError) {
        break;
      }
    }
  }

  console.log("\n=== Fleet Summary ===");
  for (const result of results) {
    console.log(`${result.status.toUpperCase().padEnd(8)} ${result.repo} :: ${result.detail}`);
  }

  const failedCount = results.filter((r) => r.status === "failed").length;
  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
