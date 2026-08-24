#!/usr/bin/env node
// scripts/release.mjs
// One-click release: bump version → build → smoke test → commit → tag → push.
//
// Usage:
//   pnpm release                 # patch bump (0.1.1 → 0.1.2)
//   pnpm release:minor           # minor bump (0.1.1 → 0.2.0)
//   pnpm release:major           # major bump (0.1.1 → 1.0.0)
//
// Prerequisites:
//   - Clean working tree (no uncommitted changes).
//   - Remote `origin` pointing to the GitLab repo.
//   - pnpm available; pnpm build / pnpm test:package will run.
//
// After this script finishes, users can install the new version via:
//   dsh plugin --profile web add git+http://gitlab.iheatingos.com:8083/engios/dsh-feature-dev.git#v<NEW_VERSION>

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`❌ Invalid bump type: ${bump}`);
  console.error(`   Usage: pnpm release [patch|minor|major]`);
  process.exit(1);
}

const run = (cmd, opts = {}) => {
  console.log(`\n› ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
  } catch {
    console.error(`\n❌ Command failed: ${cmd}`);
    process.exit(1);
  }
};

// 1. Pre-flight: clean tree.
const status = execSync('git status --porcelain', { encoding: 'utf8', cwd: ROOT });
if (status.trim()) {
  console.error('❌ Working tree is dirty. Commit or stash first:\n');
  console.error(status);
  process.exit(1);
}

// 2. Bump version in package.json.
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const next =
  bump === 'major' ? [a + 1, 0, 0]
  : bump === 'minor' ? [a, b + 1, 0]
  : [a, b, c + 1];
const newVer = next.join('.');
pkg.version = newVer;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
console.log(`📦 Bumped version: ${pkg.version} → ${newVer}`);

// 3. Build + smoke test.
run('pnpm build');
run('pnpm test:package');

// 4. Commit, tag, push.
run('git add package.json');
run(`git commit -m "chore(release): v${newVer}"`);
run(`git tag v${newVer}`);
run('git push origin HEAD');
run(`git push origin v${newVer}`);

const repoUrl = pkg.repository?.url?.replace(/\.git$/, '') ?? '';
console.log(`\n✅ Released v${newVer}`);
if (repoUrl) {
  console.log(`\n📥 Users can now install:`);
  console.log(`   dsh plugin --profile web add ${repoUrl}.git#v${newVer}`);
}
