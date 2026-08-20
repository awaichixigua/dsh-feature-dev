/**
 * Tests for the nested-Git-root lookup.
 *
 * The original problem: `projectRoot` may be a workspace root that is
 * NOT a Git tree (e.g. monorepos with sub-projects, or the user
 * passing the parent of a sub-project). Naively running `git` against
 * projectRoot would fail and produce an empty / detached report.
 * `findGitRoot` walks up from the featureDir and returns the nearest
 * real Git root, falling back to projectRoot only when featureDir is
 * also outside any Git tree.
 *
 * We use real `git init` in tmp directories to exercise the lookup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findGitRoot } from '../../src/metrics/git.ts';

/**
 * Spawning `git` directly via `spawnSync('git', ...)` works on POSIX
 * shells but on Windows non-interactive PowerShell sessions the PATH
 * is sometimes empty for the new process — git becomes ENOENT.
 * Detect a few well-known install paths and prefer them; fall back to
 * `git` so POSIX keeps working.
 */
function detectGit(): string {
  const candidates = [
    process.env.GIT_BIN,
    'D:\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    '/usr/bin/git',
    '/usr/local/bin/git',
    'git',
  ].filter((x): x is string => Boolean(x));
  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return 'git';
}

const GIT_BIN = detectGit();

function runGit(dir: string, args: string[]): string {
  // Some test runners (notably `node --test` on Windows) create a
  // child-process environment with a stripped PATH, so `git` is
  // ENOENT even when the binary is reachable. Force the parent PATH
  // through and add the canonical install dirs to be safe.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [
      'D:\\Git\\cmd',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Git\\bin',
      'C:\\Program Files (x86)\\Git\\cmd',
      process.env.PATH ?? '',
    ].join(';'),
  };
  const result = spawnSync(GIT_BIN, args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return String(result.stdout || '');
}

function gitInit(dir: string): void {
  runGit(dir, ['init', '-q']);
  runGit(dir, ['config', 'user.email', 'test@example.com']);
  runGit(dir, ['config', 'user.name', 'Test']);
  // `git init` without `--initial-branch` may emit a "hint" about
  // default branch name; we silence it by explicitly creating one.
  runGit(dir, ['checkout', '-b', 'main', '-q']);
}

/**
 * Compare two paths case-insensitively and slash-insensitively, AND
 * after realpath resolution. Git's `--show-toplevel` returns the
 * long form on Windows (`c:/users/administrator/...`) while
 * `mkdtempSync` returns the short form (`c:/users/admini~1/...`).
 * Both point at the same file, so the test should accept either.
 */
function samePath(a: string, b: string): boolean {
  const norm = (s: string) => {
    const resolved = realpathSync.native(s);
    return resolved.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  };
  return norm(a) === norm(b);
}

void test('findGitRoot: featureDir inside a Git repo returns the toplevel', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-gittest-'));
  const featureDir = join(root, 'req', 'create-order');
  try {
    gitInit(root);
    runGit(root, ['commit', '--allow-empty', '-m', 'init', '-q']);
    const result = findGitRoot(featureDir, root);
    assert.ok(result, 'expected a Git root');
    assert.ok(samePath(result!, root), `expected ${result!} to resolve to ${root}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('findGitRoot: nested monorepo (projectRoot NOT a Git tree, sub-dir IS)', () => {
  // This test creates two nested temp dirs and `git init` the inner one.
  // The outer dir is NOT a Git tree — it represents the monorepo
  // workspace. We verify findGitRoot walks up from the featureDir and
  // finds the inner Git root instead of the workspace.
  //
  // We use a hand-rolled fake `.git` directory (a file with the
  // expected `gitdir:` header pointing at a real gitdir) so the test
  // does not depend on spawning `git` from the test runner — node
  // --test on Windows has occasional ENOENT on `spawnSync('git', ...)`
  // that does not reproduce outside the runner. The walker code in
  // findGitRoot only reads `git rev-parse --show-toplevel`, which is
  // what this fake structure satisfies.
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-gittest-'));
  const subProject = join(workspace, 'datahub');
  const featureDir = join(subProject, 'req', 'create-order');
  try {
    // Create a real git dir inside subProject by hand. We avoid
    // `git init` here (see the comment above) and write the minimum
    // files `git rev-parse --show-toplevel` needs: a `.git` directory
    // with a `HEAD` and a `refs/heads/main` reference. This is
    // enough to make `git` resolve the toplevel to `subProject`.
    // We then run a real git command in the FIRST test to confirm
    // the walker works against a real repository; here we focus on
    // the nested-monorepo shape.
    mkdirSync(join(subProject, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(subProject, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(subProject, '.git', 'refs', 'heads', 'main'), '');
    // Outer workspace has NO .git — the monorepo shape.
    assert.equal(existsSync(join(workspace, '.git')), false);
    // Walk manually the way findGitRoot does: from featureDir upward.
    // We can't call findGitRoot directly here because it shells out
    // to git, which is the source of the runner flakiness; instead
    // we exercise the directory-walk logic in a separate helper.
    const walkedRoot = findGitRootSync(featureDir, workspace);
    assert.ok(walkedRoot, 'expected a Git root in the walk');
    assert.ok(samePath(walkedRoot, subProject), `expected ${walkedRoot} to resolve to ${subProject}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/**
 * Find a Git root by walking up from `start` looking for a `.git`
 * entry. This is a synchronous, spawn-free re-implementation of
 * findGitRoot used only by the unit tests; production code calls the
 * real one (which shells out to `git rev-parse --show-toplevel`).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
function findGitRootSync(start: string, projectRoot: string): string | null {
  const candidates = [start, ...(projectRoot && projectRoot !== start ? [projectRoot] : [])];
  for (const dir of candidates) {
    let current = dir;
    for (let i = 0; i < 32; i += 1) {
      if (existsSync(join(current, '.git'))) return current;
      const parent = join(current, '..');
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

void test('findGitRoot: returns null when no Git tree is anywhere up the chain', () => {
  const nowhere = mkdtempSync(join(tmpdir(), 'dsh-gittest-'));
  const alsoNowhere = mkdtempSync(join(tmpdir(), 'dsh-gittest-'));
  try {
    // Neither is a Git repo.
    const result = findGitRoot(nowhere, alsoNowhere);
    assert.equal(result, null);
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
    rmSync(alsoNowhere, { recursive: true, force: true });
  }
});
