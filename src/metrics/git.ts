/**
 * Git call wrappers.
 *
 * Every command is run with `windowsHide: true` and a 64 MB stdout buffer, which
 * is the same policy the original `feature-dev/.workflow/scripts/feature-dev-run-metrics.js`
 * uses. The diff output can be many MB on a large repo; without `maxBuffer`
 * Node's spawnSync truncates silently and we end up parsing half a diff.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class GitError extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Run a git command and return stdout as a string. Throws GitError on failure. */
export function runGit(args: string[], options: GitRunOptions = {}): string {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new GitError(result.error.message, { args });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new GitError(
      `git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`,
      { args, status: result.status, stderr: detail }
    );
  }
  return String(result.stdout || '');
}

/** Resolve HEAD commit SHA, lowercased. */
export function gitHead(projectRoot: string): string {
  return runGit(['rev-parse', 'HEAD'], { cwd: projectRoot }).trim().toLowerCase();
}

/** Resolve HEAD^{tree} SHA, lowercased. */
export function gitHeadTree(projectRoot: string): string {
  return runGit(['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot }).trim().toLowerCase();
}

/** Get current branch. Throws if HEAD is detached. */
export function gitBranch(projectRoot: string): string {
  const branch = runGit(['branch', '--show-current'], { cwd: projectRoot }).trim();
  if (!branch) throw new GitError('Git repository is in detached HEAD state', { projectRoot });
  return branch;
}

/**
 * Take a worktree snapshot without mutating the real index. We read HEAD into
 * a throwaway index, add -A, write a tree, and clean up. The returned tree
 * SHA represents "what HEAD + the unstaged/staged worktree would look like
 * as a single tree object" — that's the baseline we diff against at finishRun.
 */
export function snapshotWorktree(projectRoot: string): string {
  const tempIndex = join(tmpdir(), `dsh-feature-dev-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  try {
    runGit(['read-tree', 'HEAD'], { cwd: projectRoot, env });
    runGit(['add', '-A', '--', '.'], { cwd: projectRoot, env });
    return runGit(['write-tree'], { cwd: projectRoot, env }).trim().toLowerCase();
  } finally {
    try {
      // dynamic require for fs because we want a clean delete on Windows
      require('node:fs').rmSync(tempIndex, { force: true });
    } catch { /* swallow */ }
    try {
      require('node:fs').rmSync(`${tempIndex}.lock`, { force: true });
    } catch { /* swallow */ }
  }
}

/** Read origin URL and derive a normalised `<org>/<repo>` string. */
export function gitRepository(projectRoot: string): string {
  let remote = '';
  try {
    remote = runGit(['remote', 'get-url', 'origin'], { cwd: projectRoot });
  } catch {
    remote = '';
  }
  return repositoryFromRemote(remote, projectRoot);
}

export function repositoryFromRemote(remote: string, projectRoot: string): string {
  const value = String(remote || '').trim();
  let repository = '';
  try {
    const parsed = new URL(value);
    repository = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  } catch {
    const scp = value.match(/^[^@\s]+@[^:\s]+:(.+)$/);
    if (scp) repository = scp[1] ?? '';
  }
  repository = repository
    .replace(/\.git$/i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return repository || basename(projectRoot).replace(/\.git$/i, '');
}

/** Read a file at a given tree, splitting into normalised lines. */
export function readFileAtTree(projectRoot: string, tree: string, filePath: string): string[] | null {
  try {
    const buf = runGit(['show', `${tree}:${filePath}`], { cwd: projectRoot });
    if (buf === '' || buf === null) return null;
    return buf.split('\n').map((line) =>
      line
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/, '')
        .trimEnd()
    );
  } catch {
    return null;
  }
}

/** Canonical realpath; falls back to resolved path when file does not exist. */
export function canonicalPath(value: string): string {
  const resolved = isAbsolute(value) ? value : resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Walk up from `start` until `git rev-parse --show-toplevel` returns a
 * non-empty path. This is the right way to find the Git root in a
 * monorepo: `projectRoot` may be the workspace root (no .git inside)
 * while the real Git repo is a sub-directory like `datahub/`. We start
 * from the featureDir because that is where the AI's edits land and is
 * guaranteed to be inside the project; we fall back to projectRoot
 * only when featureDir is also outside any Git tree.
 *
 * Returns the toplevel path (lowercased) on success, or null when no
 * Git repo is found anywhere up the chain. Callers must NOT throw on
 * null — the reporter treats "no Git repo" as a legitimate state and
 * writes a placeholder report instead of failing the run.
 */
export function findGitRoot(featureDir: string, projectRoot?: string | null): string | null {
  const candidates = [featureDir, ...(projectRoot && projectRoot !== featureDir ? [projectRoot] : [])];
  for (const dir of candidates) {
    let current = resolve(dir);
    for (let i = 0; i < 32; i += 1) {
      try {
        const out = runGit(['rev-parse', '--show-toplevel'], { cwd: current });
        const top = out.trim();
        if (top) return top.toLowerCase();
        return null;
      } catch {
        const parent = resolve(current, '..');
        if (parent === current) break;
        current = parent;
      }
    }
  }
  return null;
}
