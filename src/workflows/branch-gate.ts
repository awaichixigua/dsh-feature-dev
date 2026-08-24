/**
 * Requirement-branch gate for implementation planning.
 *
 * The router declares the writable service repositories in apps.json. Before
 * a PRD can be written, every such repository is placed on the requirement
 * branch, creating and publishing it from origin/release when necessary.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  defaultRepoPathProbe,
  findDirectGitReposUnder,
  looksLikeGitRepository,
  type RepoPathProbe,
} from '../runtime/paths.js';

export interface GitClient {
  run(cwd: string, args: string[]): string;
  succeeds(cwd: string, args: string[]): boolean;
}

export interface BranchGateInput {
  projectRoot: string;
  featureDir: string;
  /** Requirement folder name when the MRD is still in URL-hash staging. */
  featureName?: string;
}

export interface BranchGateOutcome {
  ok: boolean;
  summary: string;
  evidence: string[];
  blocker?: string;
}

interface AppsFile {
  primary?: unknown;
  collaborators?: unknown;
  repositories?: unknown;
}

const INVALID_USERS = new Set(['administrator', 'root', 'system']);

const systemGit: GitClient = {
  run(cwd, args) {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
        windowsHide: true,
      }).trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${detail}`);
    }
  },
  succeeds(cwd, args) {
    try {
      execFileSync('git', args, {
        cwd,
        stdio: 'ignore',
        timeout: 30_000,
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  },
};

/** Create the legacy `fun_<version>_<id>_<title>_<user>` branch name. */
export function requirementBranchName(featureDir: string, userName: string): string {
  const parsed = /^([0-9]+(?:\.[0-9]+)*)_(\d+)_([^\\/]+)$/.exec(basename(featureDir));
  if (!parsed) {
    throw new Error('需求目录名必须为 {版本号}_{需求编号}_{中文需求内容}，例如 2.1.10_98532_Engios平台接入应用');
  }
  const user = normalizeBranchPart(userName);
  if (!user || INVALID_USERS.has(user.toLowerCase())) {
    throw new Error('服务仓库的 git config user.name 缺失、为默认值或无法用于分支名；请先配置有效用户名');
  }
  const title = normalizeBranchPart(parsed[3] ?? '');
  if (!title) throw new Error('需求目录名中的需求内容无法规范化为安全的分支名');
  return `fun_${parsed[1]}_${parsed[2]}_${title}_${user}`;
}

/**
 * Prepare all primary/collaborating repositories. Read-only services never
 * switch branches. This operation is deliberately synchronous: a later phase
 * must not observe only part of the service set prepared.
 */
export function prepareRequirementBranches(
  input: BranchGateInput,
  git: GitClient = systemGit,
  probe: RepoPathProbe = defaultRepoPathProbe
): BranchGateOutcome {
  try {
    const repositories = readWritableRepositories(input, probe);
    const evidence: string[] = [];
    for (const [service, repo] of repositories) {
      const gitRoot = git.run(repo, ['rev-parse', '--show-toplevel']);
      if (canonicalRepositoryPath(gitRoot) !== canonicalRepositoryPath(repo)) {
        throw new Error(`服务 ${service} 的仓库路径必须指向 Git 顶层目录：${repo}`);
      }
      const userName = git.run(repo, ['config', 'user.name']);
      const featureDir = input.featureName ? resolve(repo, 'req', input.featureName) : input.featureDir;
      const branch = requirementBranchName(featureDir, userName);

      git.run(repo, ['fetch', 'origin', '--prune']);
      if (!git.succeeds(repo, ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/release'])) {
        throw new Error(`服务 ${service} 缺少 origin/release，无法准备需求分支`);
      }
      const hasLocal = git.succeeds(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
      const hasRemote = git.succeeds(repo, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);

      const changes = git.run(repo, ['status', '--porcelain']);
      if (hasUnsafeWorktreeChanges(changes, repo, featureDir)) {
        throw new Error(`服务 ${service} 工作区存在未提交修改，不能切换到需求分支`);
      }
      if (hasRemote) {
        if (hasLocal) git.run(repo, ['switch', branch]);
        else git.run(repo, ['switch', '--track', '-c', branch, `origin/${branch}`]);
        git.run(repo, ['merge', '--ff-only', `origin/${branch}`]);
        evidence.push(`branch_ready:${service}:${branch}:remote_existing`);
      } else {
        if (hasLocal) git.run(repo, ['switch', branch]);
        else git.run(repo, ['switch', '-c', branch, '--track', 'origin/release']);
        git.run(repo, ['push', '-u', 'origin', branch]);
        evidence.push(`branch_ready:${service}:${branch}:remote_created`);
      }
    }
    return {
      ok: true,
      summary: `已为 ${repositories.length} 个主改/协同服务准备需求分支`,
      evidence,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, summary: '需求分支门禁未通过', evidence: [], blocker: detail };
  }
}

/**
 * Git for Windows may return a long path while the process was launched from
 * an equivalent 8.3 short path. Resolve both through the filesystem before
 * comparing so aliases and case differences do not create a false mismatch.
 */
function canonicalRepositoryPath(path: string): string {
  let canonical = resolve(path);
  try {
    canonical = realpathSync.native(canonical);
  } catch {
    // Tests and preflight diagnostics may intentionally use synthetic paths.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function readWritableRepositories(
  input: BranchGateInput,
  probe: RepoPathProbe = defaultRepoPathProbe
): Array<[string, string]> {
  const appsPath = resolve(input.featureDir, 'apps.json');
  if (!existsSync(appsPath)) throw new Error(`缺少服务路由结果：${appsPath}`);
  let apps: AppsFile;
  try {
    apps = JSON.parse(readFileSync(appsPath, 'utf8')) as AppsFile;
  } catch {
    throw new Error(`服务路由结果不是合法 JSON：${appsPath}`);
  }
  const services = [...new Set([
    ...asStringList(apps.primary, 'primary'),
    ...asStringList(apps.collaborators, 'collaborators'),
  ])];
  if (services.length === 0) throw new Error('apps.json 未声明主改或协同修改服务');
  if (!apps.repositories || typeof apps.repositories !== 'object' || Array.isArray(apps.repositories)) {
    throw new Error('apps.json 必须提供 repositories：服务名到服务仓库路径的映射');
  }
  const locations = apps.repositories as Record<string, unknown>;
  const problems: string[] = [];
  const pairs: Array<[string, string]> = [];
  for (const service of services) {
    const location = locations[service];
    if (typeof location !== 'string' || !location.trim()) {
      problems.push(`apps.json 缺少服务 ${service} 的仓库路径`);
      continue;
    }
    const repo = isAbsolute(location) ? resolve(location) : resolve(input.projectRoot, location);
    if (!isInside(repo, input.projectRoot)) {
      problems.push(`服务 ${service} 的仓库路径 ${repo} 超出 projectRoot ${input.projectRoot}`);
      continue;
    }
    if (!probe.exists(repo)) {
      problems.push(`服务 ${service} 的仓库路径 ${repo} 不存在`);
      continue;
    }
    if (!looksLikeGitRepository(repo, probe)) {
      const hint = buildRepoHint(repo, input.projectRoot, probe);
      problems.push(`服务 ${service} 的仓库路径 ${repo} 不是 git 仓库${hint}`);
      continue;
    }
    pairs.push([service, repo]);
  }
  if (problems.length > 0) {
    throw new Error(`apps.json 仓库路径预检未通过：\n  - ${problems.join('\n  - ')}`);
  }
  return pairs;
}

/**
 * Build a human-friendly hint when apps.json points at a directory that is
 * not a git repository. The most common mistake in monorepos is writing the
 * monorepo root (which has no `.git` of its own) into `repositories.<svc>`;
 * surface that explicitly and list the git repositories that DO live under
 * the project root.
 */
function buildRepoHint(
  repo: string,
  projectRoot: string,
  probe: RepoPathProbe
): string {
  const isMonorepoRoot = resolve(repo) === resolve(projectRoot);
  const siblings = findDirectGitReposUnder(projectRoot, probe);
  const siblingHint =
    siblings.length === 0
      ? ''
      : `。projectRoot ${projectRoot} 下检测到的 git 仓库有：${siblings.join('、')}`;
  return isMonorepoRoot
    ? `——该路径就是 projectRoot 本身，monorepo 通常会把每个服务的 git 仓库放在子目录里，请改填例如 ${resolve(projectRoot, siblings[0] ?? '<service>')}`
    : siblingHint || '，该目录下没有 .git 标记';
}

function asStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`apps.json.${field} 必须是非空服务名组成的数组`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function normalizeBranchPart(value: string): string {
  return value.trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/**
 * Early workflow phases may create untracked planning artifacts inside
 * featureDir. Permit only those: tracked edits or unrelated untracked files
 * still block a branch switch.
 */
export function hasUnsafeWorktreeChanges(status: string, repo: string, featureDir: string): boolean {
  if (!status.trim()) return false;
  const featureRelative = relative(resolve(repo), resolve(featureDir)).replace(/\\/g, '/');
  if (!featureRelative || featureRelative === '..' || featureRelative.startsWith('../')) return true;
  const prefix = `${featureRelative.replace(/\/+$/, '')}/`;
  return status.split(/\r?\n/).filter(Boolean).some((line) => {
    if (!line.startsWith('?? ')) return true;
    const path = line.slice(3).replace(/\\/g, '/');
    return path !== featureRelative && !path.startsWith(prefix);
  });
}
