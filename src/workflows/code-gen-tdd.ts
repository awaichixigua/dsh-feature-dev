/**
 * Code Gen TDD workflow.
 *
 * Phases (TECH_DESIGN.md §9.3):
 *   INITIALIZED -> PHASE1_TEST_SPEC -> AWAITING_TEST_SPEC_CONFIRMATION
 *     -> PHASE2_IMPLEMENTATION -> PHASE3_REVIEW
 *     -> (PASS/WARN) PHASE4_TEST_GENERATION -> PHASE5_TEST_EXECUTION
 *       -> (PASS/SKIPPED) PHASE6_SUMMARY -> COMPLETED
 *     -> (BLOCK) PHASE2_REPAIR -> PHASE3_REVIEW
 *   PHASE5 -> (TEST_DEFECT) PHASE4_REPAIR
 *   PHASE5 -> (PRODUCTION_DEFECT) PHASE2_REPAIR
 *
 * Repair attempts are capped at `deps.config.maxRepairAttempts`; if
 * exceeded, the run transitions to BLOCKED.
 *
 * Each phase runs a real Subagent via the `SubagentExecutor` injected
 * into `RunnerDeps`. The subagent returns a structured `PhaseResult`
 * (or its raw text is parsed for one).
 */

import type {
  ExecutionState,
  FeatureDevInvocation,
  PhaseRequest,
  PhaseResult,
} from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';
import { assertTransition, nextPhaseFromResult } from '../runtime/state-machine.js';
import { validateArtifacts, type ArtifactSpec } from '../runtime/artifact-validator.js';
import { GateEngine, type Gate } from '../runtime/gate-engine.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { isInside, resolveServiceKbContextPath } from '../runtime/paths.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';
import { runPhaseSubagent } from './subagent-runner.js';
import {
  resolveServiceTargets,
  selectRepairTargets,
  serviceStatusEvidence,
  type ServiceTarget,
} from '../runtime/service-targets.js';
import { selectFeatureTargets, type FeatureMapEntry } from '../runtime/feature-map.js';

interface PhaseDef {
  name: string;
  artifacts: ArtifactSpec[];
  gate?: Gate;
  subagent: string;
  isRepair?: boolean;
}

interface ReviewScope {
  /** Absolute paths are used so multi-service runs cannot resolve a file in the wrong repository. */
  changedFiles: string[];
  source: 'previous-phase' | 'git-working-tree' | 'empty';
  lineMode: 'added-lines-only';
}

export async function codeGenTdd(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const featureDir = inv.featureDir ?? inv.projectRoot;
  // State persistence uses featureId for the requirement directory as well.
  // Only F-xxx values are explicit, individually executable feature points.
  const selectedFeatureId = resolveSelectedFeatureId(inv.featureId, featureDir);
  const selection = selectFeatureTargets(featureDir, resolveServiceTargets(inv.projectRoot, featureDir), selectedFeatureId);
  const targets = selection.targets;
  const phases: PhaseDef[] = [
    {
      name: 'PHASE1_TEST_SPEC',
      artifacts: targets.map((target) => ({ path: featureArtifactPath(target, selectedFeatureId, 'test_spec.md'), minSize: 100, mustContain: ['# '] })),
      gate: 'post_test_spec',
      subagent: 'tdd-test-spec',
    },
    {
      name: 'PHASE2_IMPLEMENTATION',
      artifacts: [],
      subagent: 'code-impl',
    },
    {
      name: 'PHASE3_REVIEW',
      artifacts: targets.map((target) => ({ path: featureArtifactPath(target, selectedFeatureId, 'code-review.md'), minSize: 100 })),
      subagent: 'code-review',
    },
    {
      name: 'PHASE4_TEST_GENERATION',
      artifacts: [],
      subagent: 'testcode-gen',
    },
    {
      name: 'PHASE5_TEST_EXECUTION',
      artifacts: targets.map((target) => ({ path: featureArtifactPath(target, selectedFeatureId, 'unit_test_report.md'), minSize: 100 })),
      subagent: 'tdd-test-runner',
    },
    {
      name: 'PHASE6_SUMMARY',
      artifacts: [],
      subagent: 'archive-report',
    },
    {
      name: 'PHASE2_REPAIR',
      artifacts: [],
      isRepair: true,
      subagent: 'bugfix-fix',
    },
    {
      name: 'PHASE4_REPAIR',
      artifacts: [],
      isRepair: true,
      subagent: 'testcode-gen',
    },
  ];

  return driveTdd(state, inv, deps, engine, phases, targets, selectedFeatureId, selection.feature, selection.featureMapPath);
}

async function driveTdd(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  engine: GateEngine,
  phases: PhaseDef[],
  targets: ServiceTarget[],
  selectedFeatureId: string | undefined,
  feature?: FeatureMapEntry,
  featureMapPath?: string
): Promise<ExecutionState> {
  let safetyBudget = 50;
  while (safetyBudget-- > 0) {
    const current = state.currentPhase;
    if (current === 'COMPLETED' || current === 'BLOCKED' || current === 'INTERRUPTED') {
      return state;
    }
    const def = phases.find((p) => p.name === current);
    // Existing runs can be resumed from a test phase after the setting was
    // changed. Advance them without spawning a test-generating or test-running
    // subagent when unit tests were not explicitly enabled for the run.
    if (!inv.options.unitTests && isUnitTestPhase(current)) {
      const next = nextPhaseFromResult('code-gen-tdd', current, {
        status: 'pass',
        summary: 'Unit tests skipped by configuration',
        artifacts: [],
        evidence: [],
        changedFiles: [],
      }, { skipCodeGenTddTests: true });
      assertTransition('code-gen-tdd', current, next, {
        lastResult: state.lastPhaseResult,
        repairCount: state.repairCount,
        maxRepairAttempts: deps.config.maxRepairAttempts,
      });
      state = deps.repo.transition(state, next);
      continue;
    }
    if (!def) {
      const next = nextPhaseFromResult('code-gen-tdd', current, {
        status: 'pass',
        summary: '自动推进阶段',
        artifacts: [],
        evidence: [],
        changedFiles: [],
      }, { skipCodeGenTddTests: !inv.options.unitTests });
      assertTransition('code-gen-tdd', current, next, {
        lastResult: state.lastPhaseResult,
        repairCount: state.repairCount,
        maxRepairAttempts: deps.config.maxRepairAttempts,
      });
      state = deps.repo.transition(state, next);
      continue;
    }
    if (state.phaseHistory.some((h) => h.phase === def.name && (h.status === 'pass' || h.status === 'warn'))) {
      const next = nextPhaseFromResult('code-gen-tdd', def.name, {
        status: 'pass',
        summary: '该阶段已通过',
        artifacts: [],
        evidence: [],
        changedFiles: [],
      }, { skipCodeGenTddTests: !inv.options.unitTests });
      state = deps.repo.transition(state, next);
      continue;
    }
    deps.repo.beginPhase(state, def.name);
    deps.lifecycle?.onPhaseStart(state, def.name);
    const phaseTargets = def.isRepair
      ? selectRepairTargets(targets, state.lastPhaseResult?.evidence)
      : targets;
    const result = await runSubagentPhase(state, inv, deps, def, phaseTargets, selectedFeatureId, feature, featureMapPath);
    const valid = validateArtifacts(inv.projectRoot, def.artifacts);
    if (!valid.ok && def.artifacts.length > 0) {
      const failures = valid.results.filter((r) => !r.ok);
      result.status = 'failed';
      result.summary += '（必需产物校验失败）';
      result.evidence.push(
        `artifacts_missing:${failures.length}`,
        ...failures.map((r) => `artifact:${r.path}:${r.reason ?? 'invalid'}`)
      );
      result.blocker = '请创建或修复全部必需产物后再继续此阶段';
    }
    deps.repo.endPhase(state, def.name, result);
    deps.lifecycle?.onPhaseEnd(state, def.name, result);

    if (def.gate && result.status !== 'block' && result.status !== 'failed') {
      const conf = engine.raise(state, def.gate);
      state.notes = (state.notes ?? []).concat(`Gate ${def.gate} raised: ${conf.id}`);
      return state;
    }
    if (result.status === 'block' || result.status === 'failed') {
      // Let FSM pick the repair phase
      const next = nextPhaseFromResult('code-gen-tdd', def.name, result, {
        skipCodeGenTddTests: !inv.options.unitTests,
      });
      if (next === def.name || next === 'BLOCKED') {
        return deps.repo.transition(state, 'BLOCKED');
      }
      if (next.endsWith('_REPAIR')) {
        assertTransition('code-gen-tdd', def.name, next, {
          lastResult: result,
          repairCount: state.repairCount,
          maxRepairAttempts: deps.config.maxRepairAttempts,
        });
        deps.repo.bumpRepair(state, def.name, next, result.summary);
      }
      assertTransition('code-gen-tdd', def.name, next, {
        lastResult: result,
        repairCount: state.repairCount,
        maxRepairAttempts: deps.config.maxRepairAttempts,
      });
      state = deps.repo.transition(state, next);
      continue;
    }
    const next = nextPhaseFromResult('code-gen-tdd', def.name, result, {
      skipCodeGenTddTests: !inv.options.unitTests,
    });
    if (next === def.name) {
      return deps.repo.transition(state, 'BLOCKED');
    }
    assertTransition('code-gen-tdd', def.name, next, {
      lastResult: result,
      repairCount: state.repairCount,
      maxRepairAttempts: deps.config.maxRepairAttempts,
    });
    state = deps.repo.transition(state, next);
  }
  return deps.repo.transition(state, 'BLOCKED');
}

function isUnitTestPhase(phase: string): boolean {
  return phase === 'PHASE4_TEST_GENERATION'
    || phase === 'PHASE4_REPAIR'
    || phase === 'PHASE5_TEST_EXECUTION';
}

async function runSubagentPhase(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  def: PhaseDef,
  targets: ServiceTarget[],
  selectedFeatureId: string | undefined,
  feature?: FeatureMapEntry,
  featureMapPath?: string
): Promise<PhaseResult> {
  const results: Array<{ service: string; result: PhaseResult }> = [];
  for (const target of targets) {
    const result = await runSubagentForTarget(state, inv, deps, def, target, selectedFeatureId, feature, featureMapPath);
    results.push({ service: target.service, result });
  }
  return combineTargetResults(results);
}

async function runSubagentForTarget(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  def: PhaseDef,
  target: ServiceTarget,
  selectedFeatureId: string | undefined,
  feature?: FeatureMapEntry,
  featureMapPath?: string
): Promise<PhaseResult> {
  // Build the PhaseRequest
  const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'code-gen-tdd', def.subagent);
  const kbContextPath = resolveServiceKbContextPath(
    target.featureDir,
    target.projectRoot
  );
  const req: PhaseRequest = {
    runId: state.runId,
    workflow: 'code-gen-tdd',
    phase: def.name,
    projectRoot: target.projectRoot,
    featureDir: target.featureDir,
    featureId: selectedFeatureId,
    promptPath,
    inputs: {
      featureDir: target.featureDir,
      featureId: selectedFeatureId,
      service: target.service,
      ...(feature ? { feature } : {}),
      ...(featureMapPath ? { featureMapPath: resolve(target.featureDir, 'feature-map.json') } : {}),
      testSpecPath: featureArtifactPath(target, selectedFeatureId, 'test_spec.md'),
      techDesignPath: resolve(target.featureDir, 'tech-design.md'),
      codeReviewPath: featureArtifactPath(target, selectedFeatureId, 'code-review.md'),
      unitTestReportPath: featureArtifactPath(target, selectedFeatureId, 'unit_test_report.md'),
      workflow: inv.workflow,
      phase: def.name,
      mode: def.isRepair ? 'incremental-fix' : 'normal',
      options: inv.options,
      // Knowledge bases are service-scoped.  Unlike shared arch-docs, never
      // search parent directories for this path.
      kbContextPath,
      ...(def.subagent === 'code-review'
        ? { reviewScope: resolveReviewScope(state.lastPhaseResult?.changedFiles, target.projectRoot) }
        : {}),
      ...(def.subagent === 'tdd-test-spec'
        ? { testSpecTemplatePath: resolve(deps.ctx.packageRoot, 'templates', 'test_spec_template.md') }
        : {}),
      state: {
        currentPhase: state.currentPhase,
        repairCount: state.repairCount,
        lastPhaseResult: state.lastPhaseResult,
      },
    },
    expectedArtifacts: def.artifacts
      .filter((artifact) => artifact.path.startsWith(`${target.featureDir}/`))
      .map((artifact) => artifact.path),
    mode: def.isRepair ? 'incremental-fix' : 'normal',
  };
  try {
    const beforeChanges = mutatesImplementation(def)
      ? snapshotGitChanges(target.projectRoot)
      : undefined;
    const result = await runPhaseSubagent(state, req, deps);
    const observedChanges = beforeChanges
      ? changedSinceSnapshot(beforeChanges, snapshotGitChanges(target.projectRoot))
      : [];
    return {
      ...result,
      changedFiles: [...new Set([
        ...normalizeChangedFiles(result.changedFiles, target.projectRoot),
        ...observedChanges,
      ])],
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      status: 'failed',
      summary: `子代理 ${def.subagent} 执行失败：${detail}`,
      artifacts: [],
      evidence: [`subagent_failure:${def.subagent}`],
      changedFiles: [],
      blocker: `请解决 ${def.subagent} 的子模型、提供方或运行时错误后再继续运行`,
    };
  }
}

function mutatesImplementation(def: PhaseDef): boolean {
  return def.name === 'PHASE2_IMPLEMENTATION' || def.name === 'PHASE2_REPAIR';
}

/**
 * Build the authoritative review target list. Prefer the immediately preceding
 * implementation/repair result, because a repository can already contain
 * unrelated user changes. Git working-tree discovery is only a compatibility
 * fallback for older execution states that did not persist changedFiles.
 */
export function resolveReviewScope(previousChangedFiles: string[] | undefined, projectRoot: string): ReviewScope {
  const previous = normalizeChangedFiles(previousChangedFiles ?? [], projectRoot);
  if (previous.length > 0) {
    return { changedFiles: previous, source: 'previous-phase', lineMode: 'added-lines-only' };
  }

  const workingTree = collectGitChangedFiles(projectRoot);
  return {
    changedFiles: workingTree,
    source: workingTree.length > 0 ? 'git-working-tree' : 'empty',
    lineMode: 'added-lines-only',
  };
}

function normalizeChangedFiles(files: string[], projectRoot: string): string[] {
  const root = resolve(projectRoot);
  return [...new Set(files.flatMap((file) => {
    const trimmed = file.trim();
    if (!trimmed) return [];
    const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
    return isInside(absolute, root) ? [absolute] : [];
  }))];
}

function collectGitChangedFiles(projectRoot: string): string[] {
  const commands = [
    ['diff', '--name-only', '-z', '--diff-filter=ACMRTUXB', '--'],
    ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTUXB', '--'],
    ['ls-files', '--others', '--exclude-standard', '-z', '--'],
  ];
  const files: string[] = [];
  for (const args of commands) {
    try {
      const output = execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
        windowsHide: true,
      });
      files.push(...output.split('\0').filter(Boolean));
    } catch {
      return [];
    }
  }
  return normalizeChangedFiles(files, projectRoot);
}

function snapshotGitChanges(projectRoot: string): Map<string, string> {
  return new Map(collectGitChangedFiles(projectRoot).map((file) => [file, fileFingerprint(file)]));
}

function changedSinceSnapshot(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].flatMap(([file, fingerprint]) => (
    before.get(file) === fingerprint ? [] : [file]
  ));
}

function fileFingerprint(file: string): string {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    // Missing or unreadable paths can only represent removals. Review is
    // added-line-only, so they do not belong in its target list.
    return 'missing';
  }
}

function combineTargetResults(results: Array<{ service: string; result: PhaseResult }>): PhaseResult {
  const failed = results.find(({ result }) => result.status === 'failed');
  const blocked = results.find(({ result }) => result.status === 'block');
  const warned = results.some(({ result }) => result.status === 'warn');
  const selected = failed ?? blocked;
  return {
    status: selected?.result.status ?? (warned ? 'warn' : 'pass'),
    summary: results.map(({ service, result }) => `[${service}] ${result.summary}`).join('；'),
    artifacts: results.flatMap(({ result }) => result.artifacts),
    evidence: results.flatMap(({ service, result }) => [
      serviceStatusEvidence(service, result.status),
      ...result.evidence,
    ]),
    changedFiles: results.flatMap(({ result }) => result.changedFiles),
    ...(selected?.result.blocker ? { blocker: `[${selected.service}] ${selected.result.blocker}` } : {}),
  };
}

/** Feature-specific work keeps its artifacts separate from an all-feature run. */
function featureArtifactPath(target: ServiceTarget, featureId: string | undefined, filename: string): string {
  if (!featureId) return `${target.featureDir}/ai/${filename}`;
  return `${target.featureDir}/ai/${featureId}/${filename}`;
}

function resolveSelectedFeatureId(value: string | undefined, featureDir: string): string | undefined {
  if (!value || value === basename(featureDir)) return undefined;
  if (!/^F-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`--feature-id must use the F-<identifier> form: ${value}`);
  }
  return value;
}

export const _initial = 'INITIALIZED';
