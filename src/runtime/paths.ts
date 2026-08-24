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
import { basename, dirname, resolve, sep, isAbsolute } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ExecutorError, ForbiddenError, NotFoundError, ValidationError } from './errors.js';

export interface PathContext {
  packageRoot: string;
  projectRoot: string;
}

/**
 * Resolve the temporary directory used before routing selects a service.
 * A required feature directory gives the run a stable business identity, so
 * it takes precedence over the legacy URL hash. The hash remains a fallback
 * for older low-level callers that genuinely have no feature identity.
 */
export function resolveMrdStagingDir(projectRoot: string, mrdUrl: string, featureDir?: string): string {
  if (featureDir) {
    const name = basename(featureDir);
    if (name && name !== '.' && name !== '..') {
      return resolve(projectRoot, '.tmp', name);
    }
  }
  const fingerprint = createHash('sha256').update(mrdUrl).digest('hex').slice(0, 12);
  return resolve(projectRoot, '.tmp', `mrdoc-${fingerprint}`);
}

/**
 * Resolve the service-scoped knowledge-base entry for a feature.
 *
 * In a multi-service workspace projectRoot can be the aggregate repository,
 * while featureDir is <service>/req/<feature>. KB lookup must stop at that
 * service root and must not drift to an aggregate-level app-knowledge-base.
 */
export function resolveServiceKbContextPath(featureDir: string, projectRoot: string): string {
  const feature = resolve(featureDir);
  const project = resolve(projectRoot);
  let current = dirname(feature);
  let serviceRoot: string | undefined;

  while (isInside(current, project)) {
    if (basename(current).toLowerCase() === 'req') {
      serviceRoot = dirname(current);
      break;
    }
    if (existsSync(resolve(current, '.git'))) {
      serviceRoot = current;
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return resolve(serviceRoot ?? project, 'app-knowledge-base', 'CONTEXT.md');
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

/**
 * Filesystem probe for the apps.json repository preflight. Splitting this
 * out lets tests inject a deterministic probe without touching the real
 * filesystem, and lets the SERVICE_ROUTER and BRANCH_GATE phases share
 * the same "is this path really a git repository?" check.
 */
export interface RepoPathProbe {
  exists(path: string): boolean;
  isGitRepository(path: string): boolean;
  listGitReposUnder(root: string): string[];
}

export const defaultRepoPathProbe: RepoPathProbe = {
  exists: (p) => existsSync(p),
  isGitRepository: (p) => existsSync(resolve(p, '.git')),
  listGitReposUnder: (root) => {
    if (!existsSync(root)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const child = resolve(root, entry.name);
      if (existsSync(resolve(child, '.git'))) out.push(entry.name);
    }
    return out.sort();
  },
};

/** Lightweight check: does the path look like a git repository toplevel? */
export function looksLikeGitRepository(
  path: string,
  probe: RepoPathProbe = defaultRepoPathProbe
): boolean {
  return probe.exists(path) && probe.isGitRepository(path);
}

/**
 * Direct git repositories that live one level under `root`. Used to build
 * "the path you wrote is the monorepo root, but the git repositories are
 * here" hints when apps.json misroutes a service.
 */
export function findDirectGitReposUnder(
  root: string,
  probe: RepoPathProbe = defaultRepoPathProbe
): string[] {
  return probe.listGitReposUnder(root);
}
