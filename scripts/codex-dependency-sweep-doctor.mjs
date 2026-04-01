#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

function run(command, args, { check = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (check && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `${command} ${args.join(" ")} failed`);
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function pass(label, detail) {
  return { ok: true, label, detail };
}

function fail(label, detail) {
  return { ok: false, label, detail };
}

function checkCommand(command) {
  const result = run(command, ["--version"]);
  if (result.status !== 0) {
    return fail(`Command: ${command}`, "not available on PATH");
  }
  const firstLine = (result.stdout || result.stderr).trim().split("\n")[0];
  return pass(`Command: ${command}`, firstLine || "available");
}

function checkNodeMatchesNvmrc() {
  const nvmrcPath = path.join(repoRoot, ".nvmrc");
  const expectedRaw = readFileSync(nvmrcPath, "utf8").trim();
  const expected = expectedRaw.replace(/^v/, "");
  const current = process.version.replace(/^v/, "");

  if (current === expected || current.startsWith(`${expected}.`)) {
    return pass("Node version", `${current} matches .nvmrc (${expectedRaw})`);
  }
  return fail("Node version", `${current} does not match .nvmrc (${expectedRaw}); run nvm use`);
}

function checkCodexAuth() {
  const result = run("codex", ["login", "status"]);
  if (result.status === 0) {
    return pass("Codex auth", "authenticated");
  }
  return fail("Codex auth", "not authenticated; run codex login");
}

function checkGhAuth() {
  const result = run("gh", ["auth", "status"]);
  if (result.status === 0) {
    return pass("GitHub auth", "authenticated");
  }
  return fail("GitHub auth", "not authenticated; run gh auth login");
}

function checkGitIdentity() {
  const name = run("git", ["config", "--get", "user.name"]).stdout.trim();
  const email = run("git", ["config", "--get", "user.email"]).stdout.trim();

  if (name && email) {
    return pass("Git author identity", `${name} <${email}>`);
  }
  return fail(
    "Git author identity",
    "missing user.name and/or user.email; set git config --global user.name/user.email",
  );
}

function checkOriginRemote() {
  const result = run("git", ["remote", "get-url", "origin"]);
  if (result.status !== 0) {
    return fail("Git remote origin", "origin remote is missing");
  }
  return pass("Git remote origin", result.stdout.trim());
}

function checkOriginReachable() {
  const result = run("git", ["ls-remote", "--heads", "origin"]);
  if (result.status !== 0) {
    return fail("Git remote connectivity", "unable to reach origin (network or auth issue)");
  }
  return pass("Git remote connectivity", "origin reachable");
}

function checkNcuRunnable() {
  const result = run("npx", ["npm-check-updates", "--version"]);
  if (result.status !== 0) {
    return fail("npm-check-updates", "not runnable via npx");
  }
  return pass("npm-check-updates", `version ${result.stdout.trim()}`);
}

function printCheck(result) {
  const prefix = result.ok ? "PASS" : "FAIL";
  console.log(`${prefix}  ${result.label}: ${result.detail}`);
}

const checks = [
  checkCommand("git"),
  checkCommand("node"),
  checkCommand("npm"),
  checkCommand("npx"),
  checkCommand("gh"),
  checkCommand("codex"),
  checkNodeMatchesNvmrc(),
  checkCodexAuth(),
  checkGhAuth(),
  checkGitIdentity(),
  checkOriginRemote(),
  checkOriginReachable(),
  checkNcuRunnable(),
];

checks.forEach(printCheck);

const failures = checks.filter((c) => !c.ok);
if (failures.length > 0) {
  console.error(`\nEnvironment check failed (${failures.length} issue${failures.length === 1 ? "" : "s"}).`);
  process.exit(1);
}

console.log("\nEnvironment check passed. Ready for deps:codex:auto.");
