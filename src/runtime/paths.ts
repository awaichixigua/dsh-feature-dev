/**
 * Path & boundary resolution.
 *
 * - `packageRoot`  — where the bundle's own resources live (read-only).
 *                    Derived from `import.meta.url` of the plugin entry.
 * - `projectRoot`  — user's business project. Default: nearest git toplevel
 *                    from CWD, or the user-supplied path. NEVER inherited
 *                    from $HOME, $CLAUDE_PLUGIN_ROOT or any Claude path.
 * - `featureDir`   — a directory of work inside `projectRoot`. MUST resolve
 *                    inside an `allowedFeatureRoots` entry.
 * - `resourceBase` — a directory of a Skill/Agent's own resources.
 *
 * Every helper here performs `resolve()` first, then `startsWith`-based
 * containment check. The order matters: never compare non-resolved paths.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ExecutorError, ForbiddenError, NotFoundError, ValidationError } from './errors.js';

export interface PathContext {
  packageRoot: string;
  projectRoot: string;
}

const PROJECT_MARKERS = ['.git', 'package.json'];

/**
 * Resolve packageRoot from import.meta.url. Should be called once at plugin
 * apply() and stashed on the cordis context.
 */
export function resolvePackageRoot(importMetaUrl: string): string {
  const here = dirname(fileURLToPath(importMetaUrl));
  let cur = here;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(cur, 'package.json'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return here;
}

/**
 * Resolve projectRoot.
 * Priority: explicit arg > env DSH_PROJECT_ROOT > nearest git toplevel of cwd.
 */
export function resolveProjectRoot(opts: { explicit?: string; cwd?: string }): string {
  const explicit = opts.explicit ?? process.env.DSH_PROJECT_ROOT;
  if (explicit) {
    if (!isAbsolute(explicit)) {
      throw new ValidationError('projectRoot must be an absolute path', { value: explicit });
    }
    if (!existsSync(explicit)) {
      throw new NotFoundError('projectRoot does not exist', { path: explicit });
    }
    return resolve(explicit);
  }
  const cwd = opts.cwd ?? process.cwd();
  const gitTop = nearestGitToplevel(cwd);
  if (gitTop) return gitTop;
  return resolve(cwd);
}

function nearestGitToplevel(start: string): string | undefined {
  let cur = resolve(start);
  for (let i = 0; i < 16; i++) {
    if (existsSync(resolve(cur, '.git'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}

/**
 * Validate that a featureDir is inside the projectRoot, and not a system
 * dir, never a Claude plugin dir, and not a sibling of the packageRoot.
 */
export function validateFeatureDir(featureDir: string, projectRoot: string): string {
  if (!isAbsolute(featureDir)) {
    throw new ValidationError('featureDir must be an absolute path', { value: featureDir });
  }
  const abs = resolve(featureDir);
  const projAbs = resolve(projectRoot);
  if (!isInside(abs, projAbs)) {
    throw new ForbiddenError('featureDir is outside projectRoot', {
      featureDir: abs,
      projectRoot: projAbs,
    });
  }
  const lower = abs.toLowerCase().replace(/\\/g, '/');
  const banned = ['/.claude/', '/plugins/marketplaces/', '/feature-dev/', '/node_modules/'];
  for (const b of banned) {
    if (lower.includes(b)) {
      throw new ForbiddenError(`featureDir touches a banned path: ${b}`, { featureDir: abs });
    }
  }
  return abs;
}

export function isInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

/**
 * Resolve resourceBase for a Skill/Agent. Must be a directory inside the
 * packageRoot, never the project root.
 */
export function resolveResourceBase(packageRoot: string, relativeDir: string): string {
  if (isAbsolute(relativeDir)) {
    throw new ValidationError('resourceBase relative dir must not be absolute', { value: relativeDir });
  }
  const abs = resolve(packageRoot, relativeDir);
  if (!isInside(abs, packageRoot)) {
    throw new ForbiddenError('resourceBase escaped packageRoot', { abs, packageRoot });
  }
  if (!existsSync(abs)) {
    throw new NotFoundError('resourceBase does not exist', { abs });
  }
  return abs;
}

/**
 * Run a git command in a working directory. Used by workflow pre-checks.
 * Never invokes shell. Uses execFileSync to avoid injection.
 */
export function safeGit(cwd: string, args: string[]): string {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      windowsHide: true,
    });
    return out.trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ExecutorError(`git command failed: ${msg}`, { cwd, args });
  }
}

/**
 * Detect one of the project markers at a given directory.
 */
export function hasProjectMarker(dir: string): boolean {
  for (const m of PROJECT_MARKERS) {
    if (existsSync(resolve(dir, m))) return true;
  }
  return false;
}
