/**
 * Implementation Plan workflow.
 *
 * Phases: INITIALIZED -> MRD_READER -> SERVICE_ROUTER -> [service scope confirmation]
 * -> BRANCH_GATE -> CLARIFY -> PRD -> TECH_DESIGN -> COMPLETED
 *
 * Each phase runs a real Subagent via the `SubagentExecutor` injected
 * into `RunnerDeps`. PhaseRequest inputs carry the project context.
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
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { StateRepository } from '../runtime/state-repository.js';
import { isInside } from '../runtime/paths.js';
import { runPhaseSubagent } from './subagent-runner.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';
import { prepareRequirementBranches } from './branch-gate.js';

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
      run: makeRunner('mrd-reader'),
    },
    {
      name: 'SERVICE_ROUTER',
      artifacts: (current) => [{ path: `${current.featureDir}/apps.json`, minSize: 2, mustContain: ['repositories'] }],
      // Branch preparation can fetch, switch, create, and push branches in
      // every writable service. Require the user to approve app-router's
      // scope before performing any of those repository mutations.
      gate: 'post_service_router',
      subagent: 'app-router',
      run: makeRunner('app-router'),
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
      // Clarification intentionally runs only after routing and the branch
      // gate have selected a concrete primary service repository. This gives
      // the agent the service-owned MRD and knowledge-base path to cross-check.
      name: 'CLARIFY',
      artifacts: [],
      subagent: 'mrd-clarify',
      run: makeRunner('mrd-clarify'),
    },
    {
      name: 'PRD',
      artifacts: (current) => [{ path: `${current.featureDir}/prd.md`, minSize: 200, mustContain: ['# ']}],
      gate: 'pre_prd',
      subagent: 'prd-generator',
      run: makeRunner('prd-generator'),
    },
    {
      name: 'TECH_DESIGN',
      artifacts: (current) => [{ path: `${current.featureDir}/tech-design.md`, minSize: 200, mustContain: ['# ']}],
      gate: 'pre_tech_design',
      subagent: 'tech-design',
      run: makeRunner('tech-design'),
    },
  ];
  return drivePhases(state, inv, deps, engine, 'implementation-plan', phases);
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
  const serviceRepo = new StateRepository({ projectRoot: inv.projectRoot, featureDir: primaryFeatureDir });
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
    const kbLocalPath = subagent === 'mrd-clarify'
      ? resolveServiceKnowledgeBase(inv.featureDir)
      : undefined;
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
        ...(subagent === 'mrd-clarify' || subagent === 'app-router'
          ? { mrdOriginalPath: resolve(inv.featureDir ?? inv.projectRoot, 'mrd-original.md') }
          : {}),
        ...(kbLocalPath ? {
          kb_local_path: kbLocalPath,
          kbContextPath: join(kbLocalPath, 'CONTEXT.md'),
        } : {}),
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
