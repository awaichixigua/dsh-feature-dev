#!/usr/bin/env node
// One-click release: validate -> bump version -> commit -> tag -> push.
//
// Releases are intentionally limited to the protected master branch so a
// version tag can never be created from an unmerged feature branch.

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const RELEASE_BRANCH = 'master';
const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Invalid bump type: ${bump}`);
  console.error('Usage: pnpm release [patch|minor|major]');
  process.exit(1);
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  if (process.platform === 'win32' && command === PNPM_COMMAND) {
    // Resolve to pnpm's absolute path on first use. PowerShell and cmd.exe
    // inherit different PATHs, so spawning `pnpm` by name from inside
    // execSync can hit ENOENT even when pnpm is installed globally.
    execFileSync(resolvePnpm(), args, { stdio: 'inherit', cwd: ROOT });
    return;
  }
  execFileSync(command, args, { stdio: 'inherit', cwd: ROOT });
}

let cachedPnpmPath = null;
function resolvePnpm() {
  if (cachedPnpmPath) return cachedPnpmPath;
  if (process.platform !== 'win32') {
    cachedPnpmPath = 'pnpm';
    return cachedPnpmPath;
  }
  try {
    const out = execFileSync('where', ['pnpm'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    cachedPnpmPath = first || 'pnpm.cmd';
  } catch {
    cachedPnpmPath = 'pnpm.cmd';
  }
  return cachedPnpmPath;
}

function readCommand(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', cwd: ROOT }).trim();
}

function hasTag(tag) {
  return spawnSync('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {
    cwd: ROOT,
    stdio: 'ignore',
  }).status === 0;
}

const packageText = readFileSync(PKG_PATH, 'utf8');
let versionWasWritten = false;
let releaseWasCommitted = false;

try {
  const status = readCommand('git', ['status', '--porcelain']);
  if (status) {
    throw new Error(`Working tree is dirty. Commit or stash first:\n${status}`);
  }

  const branch = readCommand('git', ['branch', '--show-current']);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(`Releases must run from ${RELEASE_BRANCH}; current branch is ${branch || '(detached HEAD)'}.`);
  }

  const pkg = JSON.parse(packageText);
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`package.json version must be stable semver (x.y.z), got ${JSON.stringify(pkg.version)}.`);
  }

  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const next =
    bump === 'major' ? [major + 1, 0, 0]
    : bump === 'minor' ? [major, minor + 1, 0]
    : [major, minor, patch + 1];
  const newVersion = next.join('.');
  const tag = `v${newVersion}`;

  if (hasTag(tag)) {
    throw new Error(`Tag ${tag} already exists. Choose another version before releasing.`);
  }

  // Validate before changing tracked files, so test failures leave no dirty tree.
  run(PNPM_COMMAND, ['build']);
  run(PNPM_COMMAND, ['test:package']);

  pkg.version = newVersion;
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  versionWasWritten = true;
  console.log(`\nBumped version: ${major}.${minor}.${patch} -> ${newVersion}`);

  run('git', ['add', '--', 'package.json']);
  run('git', ['commit', '-m', `chore(release): ${tag}`]);
  releaseWasCommitted = true;
  run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);
  run('git', ['push', 'origin', `HEAD:refs/heads/${RELEASE_BRANCH}`]);
  run('git', ['push', 'origin', tag]);

  const repoUrl = pkg.repository?.url?.replace(/\.git$/, '') ?? '';
  console.log(`\nReleased ${tag}`);
  if (repoUrl) {
    console.log(`Install: dsh plugin --profile web add ${repoUrl}.git#${tag}`);
  }
} catch (error) {
  if (versionWasWritten && !releaseWasCommitted) {
    writeFileSync(PKG_PATH, packageText);
    spawnSync('git', ['restore', '--staged', '--', 'package.json'], { cwd: ROOT, stdio: 'ignore' });
    console.error('\nRelease failed before commit; package.json has been restored.');
  } else if (releaseWasCommitted) {
    console.error('\nRelease failed after the release commit was created. Inspect the local commit and tag before retrying.');
  }
  console.error(`\nRelease failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
