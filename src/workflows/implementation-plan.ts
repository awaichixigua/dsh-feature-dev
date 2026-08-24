/**
 * Implementation Plan workflow.
 *
 * Phases: INITIALIZED -> MRD_READER -> SERVICE_ROUTER -> [service scope confirmation]
 * -> BRANCH_GATE -> CLARIFY -> PRD -> TECH_DESIGN -> COMPLETED
 *
 * Document-generation phases run real Subagents via the `SubagentExecutor`
 * injected into `RunnerDeps`. MRD clarification is owned by the main
 * conversation and is represented as a persisted pendingMainAction.
 */

import type {
  ExecutionState,
  FeatureDevInvocation,
  PhaseRequest,
  PhaseResult,
} from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';
import { drivePhases, type PhaseSpec } from './phase-driver.js';
import { GateEngine } from '../runtime/gate-engine.js';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StateRepository } from '../runtime/state-repository.js';
import { isInside } from '../runtime/paths.js';
import { defaultRepoPathProbe, findDirectGitReposUnder, looksLikeGitRepository, type RepoPathProbe } from '../runtime/paths.js';
import { runPhaseSubagent } from './subagent-runner.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';
import { prepareRequirementBranches } from './branch-gate.js';
import { resolveServiceTargets } from '../runtime/service-targets.js';

export async function implementationPlan(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const phases: PhaseSpec[] = [
    {
      name: 'MRD_READER',
      artifacts: (current) => [{ path: `${current.featureDir}/mrd-original.md`, minSize: 1 }],
      subagent: 'mrd-reader',
      run: readRequirementSource,
    },
    {
      name: 'SERVICE_ROUTER',
      // The router may legitimately be unable to identify a service from an
      // infrastructure-only MRD. In that case the main conversation, rather
      // than artifact validation, owns the service-scope question.
      artifacts: [],
      // Branch preparation can fetch, switch, create, and push branches in
      // every writable service. Require the user to approve app-router's
      // scope before performing any of those repository mutations.
      gate: 'post_service_router',
      subagent: 'app-router',
      run: runServiceRouter,
    },
    {
      name: 'BRANCH_GATE',
      artifacts: [],
      run: async (_state, currentInv) => {
        const outcome = prepareRequirementBranches({
          projectRoot: currentInv.projectRoot,
          featureDir: currentInv.featureDir ?? currentInv.projectRoot,
          featureName: currentInv.featureId,
        });
        return {
          status: outcome.ok ? 'pass' : 'block',
          summary: outcome.summary,
          artifacts: [],
          evidence: outcome.evidence,
          changedFiles: [],
          ...(outcome.blocker ? { blocker: outcome.blocker } : {}),
        };
      },
      afterPass: (current, currentInv, currentDeps) => settleDocumentsIntoService(current, currentInv, currentDeps),
    },
    {
      // Clarification is deliberately not a subagent phase. A child session
      // must never ask the user questions. The main conversation reads the
      // routed MRD/knowledge base, conducts the dialogue, writes the artifact,
      // then resumes this run; the local check passes straight into PRD.
      name: 'CLARIFY',
      artifacts: [],
      run: awaitMainConversationClarification,
    },
    {
      name: 'PRD',
      artifacts: (current) => [{ path: `${current.featureDir}/prd.md`, minSize: 200, mustContain: ['# ']}],
      gate: 'pre_prd',
      subagent: 'prd-generator',
      run: makeRunner('prd-generator'),
      afterPass: (current, currentInv) => syncPlanningArtifact(current, currentInv, 'prd.md'),
    },
    {
      name: 'TECH_DESIGN',
      artifacts: (current) => [
        { path: `${current.featureDir}/tech-design.md`, minSize: 200, mustContain: ['# '] },
        { path: `${current.featureDir}/feature-map.json`, minSize: 80, json: true },
      ],
      gate: 'pre_tech_design',
      subagent: 'tech-design',
      run: makeRunner('tech-design'),
      afterPass: (current, currentInv) => {
        syncPlanningArtifact(current, currentInv, 'tech-design.md');
        syncPlanningArtifact(current, currentInv, 'feature-map.json');
      },
    },
  ];
  return drivePhases(state, inv, deps, engine, 'implementation-plan', phases);
}

/** Copy the primary service's shared planning artifacts to every other writable service. */
function syncPlanningArtifact(state: ExecutionState, inv: FeatureDevInvocation, filename: 'prd.md' | 'tech-design.md' | 'feature-map.json'): void {
  const source = resolve(state.featureDir, filename);
  if (!existsSync(source)) throw new Error(`Planning artifact is missing: ${source}`);
  const primary = resolve(state.featureDir);
  // Older single-service plans can have a lightweight apps.json without
  // repository routing. There is no collaborator destination in that case.
  let targets: ReturnType<typeof resolveServiceTargets>;
  try {
    targets = resolveServiceTargets(inv.projectRoot, state.featureDir);
  } catch {
    return;
  }
  for (const target of targets) {
    if (resolve(target.featureDir) === primary) continue;
    mkdirSync(target.featureDir, { recursive: true });
    copyFileSync(source, resolve(target.featureDir, filename));
  }
}

/**
 * Materialize inline requirement text locally. This is the direct-input
 * alternative to MRDoc fetching and deliberately does not spawn mrd-reader.
 * Downstream routing and document phases continue to consume the same
 * mrd-original.md contract regardless of where the requirement came from.
 */
async function readRequirementSource(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<PhaseResult> {
  const requirement = inv.rawUserRequest?.trim();
  if (!requirement) {
    if (inv.mrdUrl) return makeRunner('mrd-reader')(state, inv, deps);
    return {
      status: 'block',
      summary: '缺少需求来源',
      artifacts: [],
      evidence: ['requirement_source:missing'],
      changedFiles: [],
      blocker: '请提供 MRDoc 地址或直接输入需求内容后重新运行。',
    };
  }

  const stagingFeatureDir = resolve(inv.featureDir ?? state.featureDir);
  const originalPath = resolve(stagingFeatureDir, 'mrd-original.md');
  const sourcePath = resolve(stagingFeatureDir, '.tmp', 'mrd-source.json');
  mkdirSync(resolve(stagingFeatureDir, '.tmp'), { recursive: true });
  writeFileSync(originalPath, `# 原始需求\n\n${requirement}\n`, 'utf8');
  writeFileSync(sourcePath, JSON.stringify({
    sourceType: 'direct-input',
    sha256: createHash('sha256').update(requirement).digest('hex'),
  }, null, 2) + '\n', 'utf8');
  return {
    status: 'pass',
    summary: '已将直接输入的需求保存为原始需求文档',
    artifacts: [originalPath, sourcePath],
    evidence: ['requirement_source:direct-input'],
    changedFiles: [originalPath, sourcePath],
  };
}

interface RoutedApps {
  primary?: unknown;
  collaborators?: unknown;
  repositories?: unknown;
}

/**
 * Copy the URL-hash staging documents into every writable service, then move
 * the authoritative run state to the primary service's requirement folder.
 * This deliberately runs only after the branch gate: no formal requirement
 * files are created in a service worktree before its requirement branch is
 * ready.
 */
function settleDocumentsIntoService(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): void {
  const stagingDir = inv.featureDir;
  if (!stagingDir || !isInside(stagingDir, resolve(inv.projectRoot, '.tmp'))) return;
  const appsPath = resolve(stagingDir, 'apps.json');
  const apps = JSON.parse(readFileSync(appsPath, 'utf8')) as RoutedApps;
  const primary = stringList(apps.primary, 'primary');
  const collaborators = stringList(apps.collaborators, 'collaborators');
  if (primary.length === 0 || !apps.repositories || typeof apps.repositories !== 'object' || Array.isArray(apps.repositories)) {
    throw new Error('apps.json must declare primary services and repositories before documents can be settled');
  }
  const repositories = apps.repositories as Record<string, unknown>;
  const name = state.featureId ?? basename(stagingDir);
  const sourceMrd = resolve(stagingDir, 'mrd-original.md');
  if (!existsSync(sourceMrd)) throw new Error(`MRD staging artifact is missing: ${sourceMrd}`);

  let primaryFeatureDir: string | undefined;
  for (const service of [...new Set([...primary, ...collaborators])]) {
    const location = repositories[service];
    if (typeof location !== 'string' || !location.trim()) {
      throw new Error(`apps.json is missing a repository path for ${service}`);
    }
    const serviceRepo = isAbsolute(location) ? resolve(location) : resolve(inv.projectRoot, location);
    const featureDir = resolve(serviceRepo, 'req', name);
    mkdirSync(featureDir, { recursive: true });
    copyFileSync(sourceMrd, resolve(featureDir, 'mrd-original.md'));
    copyFileSync(appsPath, resolve(featureDir, 'apps.json'));
    if (service === primary[0]) primaryFeatureDir = featureDir;
  }
  if (!primaryFeatureDir) throw new Error('Unable to determine the primary service requirement directory');

  // The run's state and later PRD/tech-design files belong to the primary
  // service. Preserve the staging copy as audit input, but make the service
  // directory authoritative for status/confirm/resume.
  state.featureDir = primaryFeatureDir;
  state.updatedAt = new Date().toISOString();
  const serviceRepo = new StateRepository({
    projectRoot: inv.projectRoot,
    featureDir: primaryFeatureDir,
    runId: state.runId,
  });
  if (serviceRepo.exists()) {
    const existing = serviceRepo.read();
    if (existing.runId !== state.runId) {
      throw new Error(`The routed requirement directory already has a different run state: ${serviceRepo.statePath}`);
    }
  }
  serviceRepo.ensureLayout();
  serviceRepo.writeAtomicPublic(state);
  if (existsSync(deps.repo.eventsPath)) copyFileSync(deps.repo.eventsPath, serviceRepo.eventsPath);
  serviceRepo.regenerateMarkdownPublic(state);
  serviceRepo.activateRunPublic(state);
  deps.repo = serviceRepo;
  inv.featureDir = primaryFeatureDir;
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`apps.json.${field} must be a list of service names`);
  }
  return value.map((item) => item.trim());
}

/** Build a phase.run that invokes the named subagent. */
function makeRunner(subagent: string) {
  return async (state: ExecutionState, inv: FeatureDevInvocation, deps: RunnerDeps): Promise<PhaseResult> => {
    const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'implementation-plan', subagent);
    const usesStagingOnly = isPreRoutingSubagent(subagent);
    const req: PhaseRequest = {
      runId: state.runId,
      workflow: 'implementation-plan',
      phase: inferPhaseFromSubagent(subagent),
      projectRoot: inv.projectRoot,
      ...(usesStagingOnly ? {} : { featureDir: inv.featureDir, featureId: inv.featureId }),
      promptPath,
      inputs: {
        ...(usesStagingOnly ? { stagingFeatureDir: inv.featureDir } : {
          featureDir: inv.featureDir,
          featureId: inv.featureId,
        }),
        mrdUrl: inv.mrdUrl,
        rawUserRequest: inv.rawUserRequest,
        ...(subagent === 'app-router'
          ? { mrdOriginalPath: resolve(inv.featureDir ?? inv.projectRoot, 'mrd-original.md') }
          : {}),
        options: inv.options,
        ...(subagent === 'prd-generator'
          ? { prdTemplatePath: resolve(deps.ctx.packageRoot, 'templates', 'prd-template.md') }
          : {}),
        state: {
          currentPhase: state.currentPhase,
          repairCount: state.repairCount,
        },
      },
      expectedArtifacts: [],
      mode: 'normal',
    };
    try {
      return await runPhaseSubagent(state, req, deps);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        status: 'failed',
        summary: `子代理 ${subagent} 执行失败：${detail}`,
        artifacts: [],
        evidence: [`subagent_failure:${subagent}`],
        changedFiles: [],
        blocker: `请解决 ${subagent} 的子模型、提供方或运行时错误后再继续运行`,
      };
    }
  };
}

/**
 * Keep service-routing uncertainty in the main conversation. Previously the
 * generic apps.json artifact check converted an incomplete route into a
 * failed phase, so no confirmation gate or actionable user prompt survived.
 */
async function runServiceRouter(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<PhaseResult> {
  const featureDir = resolve(inv.featureDir ?? state.featureDir);
  const appsPath = resolve(featureDir, 'apps.json');
  const mrdOriginalPath = resolve(featureDir, 'mrd-original.md');
  const pending = state.pendingMainAction;
  const existing = inspectServiceRoute(appsPath, inv.projectRoot);

  // A resumed main-conversation answer is authoritative. Do not spawn
  // app-router again and overwrite the user-confirmed service scope.
  if (pending?.kind === 'route_services') {
    if (existing.ok) {
      delete state.pendingMainAction;
      return {
        status: 'pass',
        summary: '主会话已确认服务范围，继续准备需求分支',
        artifacts: [appsPath],
        evidence: [`service_route_confirmed:${appsPath}`],
        changedFiles: [],
        gateAlreadyConfirmed: true,
      };
    }
    return routeServicesMainAction(state, mrdOriginalPath, appsPath, existing);
  }

  const result = await makeRunner('app-router')(state, inv, deps);
  // Infrastructure/runtime failures still need an operator fix; they are not
  // evidence that the user should choose a service scope.
  if (result.status === 'failed' && result.evidence.some((item) => item.startsWith('subagent_failure:'))) {
    return result;
  }
  const inspected = inspectServiceRoute(appsPath, inv.projectRoot);
  // A router-side block carries unresolved semantics even when its partial
  // apps.json happens to be structurally complete. Surface it to the main
  // conversation instead of losing the user's input opportunity.
  if (result.status === 'block' || !inspected.ok) {
    return routeServicesMainAction(state, mrdOriginalPath, appsPath, inspected);
  }
  return result;
}

function routeServicesMainAction(
  state: ExecutionState,
  mrdOriginalPath: string,
  appsPath: string,
  route: ServiceRouteInspection
): PhaseResult {
  state.pendingMainAction = {
    kind: 'route_services',
    mrdOriginalPath,
    appsPath,
    ...(route.snapshot ? { routeSnapshot: route.snapshot } : {}),
    instruction: '由主会话向用户发起服务范围确认输入：确认 primary、collaborators、readOnly，以及每个 primary/collaborator 的 repositories 路径。将确认结果写入 apps.json 后，用同一 projectRoot 和 featureDir 调用 feature_dev_resume；不要重新启动 app-router，也不要创建正式 req 目录。',
  };
  return {
    status: 'block',
    summary: '无法从 MRD 自动确认服务范围，等待主会话收集服务路由输入',
    artifacts: [],
    evidence: ['main_action:route_services', ...route.problems.map((problem) => `service_route:${problem}`)],
    changedFiles: [],
    blocker: `请由主会话确认服务范围并写入 ${appsPath}（${route.problems.join('；')}）`,
  };
}

interface ServiceRouteInspection {
  ok: boolean;
  problems: string[];
  snapshot?: Record<string, unknown>;
}

function inspectServiceRoute(
  appsPath: string,
  projectRoot?: string,
  probe: RepoPathProbe = defaultRepoPathProbe
): ServiceRouteInspection {
  if (!existsSync(appsPath)) return { ok: false, problems: ['apps.json 不存在'] };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(appsPath, 'utf8'));
  } catch {
    return { ok: false, problems: ['apps.json 不是合法 JSON'] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, problems: ['apps.json 必须是对象'] };
  }
  const snapshot = value as Record<string, unknown>;
  const primary = serviceNames(snapshot.primary, 'primary');
  const collaborators = serviceNames(snapshot.collaborators, 'collaborators');
  const problems = [...primary.problems, ...collaborators.problems];
  if (primary.names.length === 0) problems.push('primary 至少需要一个主改服务');
  const repositories = snapshot.repositories;
  if (!repositories || typeof repositories !== 'object' || Array.isArray(repositories)) {
    problems.push('repositories 必须提供主改和协同服务的仓库路径');
  } else if (projectRoot) {
    const projectRootAbs = resolve(projectRoot);
    for (const service of [...new Set([...primary.names, ...collaborators.names])]) {
      const location = (repositories as Record<string, unknown>)[service];
      if (typeof location !== 'string' || !location.trim()) {
        problems.push(`repositories.${service} 缺少仓库路径`);
        continue;
      }
      const repoAbs = isAbsolute(location) ? resolve(location) : resolve(projectRootAbs, location);
      if (!isInside(repoAbs, projectRootAbs)) {
        problems.push(`repositories.${service} 路径 ${repoAbs} 超出 projectRoot ${projectRootAbs}`);
        continue;
      }
      if (!probe.exists(repoAbs)) {
        problems.push(`repositories.${service} 路径 ${repoAbs} 不存在`);
        continue;
      }
      if (!looksLikeGitRepository(repoAbs, probe)) {
        const hint = buildServiceRouteHint(repoAbs, projectRootAbs, probe);
        problems.push(`repositories.${service} 路径 ${repoAbs} 不是 git 仓库${hint}`);
      }
    }
  } else {
    for (const service of [...new Set([...primary.names, ...collaborators.names])]) {
      const path = (repositories as Record<string, unknown>)[service];
      if (typeof path !== 'string' || !path.trim()) {
        problems.push(`repositories.${service} 缺少仓库路径`);
      }
    }
  }
  return { ok: problems.length === 0, problems, snapshot };
}

/**
 * Build a human-friendly hint when apps.json points at a directory that is
 * not a git repository. Mirrors `buildRepoHint` in branch-gate.ts so the
 * SERVICE_ROUTER and BRANCH_GATE phases give the user the same message.
 */
function buildServiceRouteHint(repo: string, projectRoot: string, probe: RepoPathProbe): string {
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

function serviceNames(value: unknown, field: string): { names: string[]; problems: string[] } {
  if (value === undefined) return { names: [], problems: [] };
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    return { names: [], problems: [`${field} 必须是服务名数组`] };
  }
  return { names: value.map((item) => item.trim()), problems: [] };
}

async function awaitMainConversationClarification(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  _deps: RunnerDeps
): Promise<PhaseResult> {
  const featureDir = resolve(inv.featureDir ?? state.featureDir);
  const mrdOriginalPath = resolve(featureDir, 'mrd-original.md');
  const mrdClarifiedPath = resolve(featureDir, 'mrd-clarified.md');
  const knowledgeBasePath = resolveServiceKnowledgeBase(featureDir);

  if (existsSync(mrdClarifiedPath) && readFileSync(mrdClarifiedPath, 'utf8').trim().length > 0) {
    delete state.pendingMainAction;
    return {
      status: 'pass',
      summary: '主会话已完成 MRD 澄清，继续生成 PRD',
      artifacts: [mrdClarifiedPath],
      evidence: [`mrd_clarified:${mrdClarifiedPath}`],
      changedFiles: [],
    };
  }

  state.pendingMainAction = {
    kind: 'clarify_mrd',
    mode: inv.options.clarifyMode ?? 'dialogue',
    mrdOriginalPath,
    mrdClarifiedPath,
    ...(knowledgeBasePath ? { knowledgeBasePath } : {}),
    instruction: '由主会话读取 MRD 与可用知识库，向用户完成需求澄清并写入 mrd-clarified.md；写入后使用同一 projectRoot 和 featureDir 调用 feature_dev_resume。不要启动 mrd-clarify 子代理。',
  };
  return {
    status: 'block',
    summary: '等待主会话完成 MRD 澄清',
    artifacts: [],
    evidence: ['main_action:clarify_mrd'],
    changedFiles: [],
    blocker: `请由主会话完成澄清并写入 ${mrdClarifiedPath}，然后直接恢复工作流`,
  };
}

/** Only MRD retrieval and service routing operate on URL-hash staging. */
function isPreRoutingSubagent(subagent: string): boolean {
  return subagent === 'mrd-reader' || subagent === 'app-router';
}

/**
 * A knowledge base belongs to a service repository, never to the shared
 * aggregate project. Return it only when its L0 context is available so the
 * clarification agent can safely fall back to MRD-only mode when it is not.
 */
function resolveServiceKnowledgeBase(featureDir: string | undefined): string | undefined {
  if (!featureDir) return undefined;
  const serviceRepo = resolve(featureDir, '..', '..');
  const kbLocalPath = resolve(serviceRepo, 'app-knowledge-base');
  return existsSync(join(kbLocalPath, 'CONTEXT.md')) ? kbLocalPath : undefined;
}

function inferPhaseFromSubagent(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
