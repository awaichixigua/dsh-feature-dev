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
import { resolve } from 'node:path';
import { resolveAgentPromptPath } from './agent-prompt-path.js';
import { runPhaseSubagent } from './subagent-runner.js';

interface PhaseDef {
  name: string;
  artifacts: ArtifactSpec[];
  gate?: Gate;
  subagent: string;
  isRepair?: boolean;
}

export async function codeGenTdd(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const featureDir = inv.featureDir ?? inv.projectRoot;
  const phases: PhaseDef[] = [
    {
      name: 'PHASE1_TEST_SPEC',
      artifacts: [{ path: `${featureDir}/ai/test_spec.md`, minSize: 100, mustContain: ['# '] }],
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
      artifacts: [{ path: `${featureDir}/ai/code-review.md`, minSize: 100 }],
      subagent: 'code-review',
    },
    {
      name: 'PHASE4_TEST_GENERATION',
      artifacts: [],
      subagent: 'testcode-gen',
    },
    {
      name: 'PHASE5_TEST_EXECUTION',
      artifacts: [{ path: `${featureDir}/ai/unit_test_report.md`, minSize: 100 }],
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

  return driveTdd(state, inv, deps, engine, phases, featureDir);
}

async function driveTdd(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  engine: GateEngine,
  phases: PhaseDef[],
  _featureDir: string
): Promise<ExecutionState> {
  let safetyBudget = 50;
  while (safetyBudget-- > 0) {
    const current = state.currentPhase;
    if (current === 'COMPLETED' || current === 'BLOCKED' || current === 'INTERRUPTED') {
      return state;
    }
    const def = phases.find((p) => p.name === current);
    if (!def) {
      const next = nextPhaseFromResult('code-gen-tdd', current, {
        status: 'pass',
        summary: '自动推进阶段',
        artifacts: [],
        evidence: [],
        changedFiles: [],
      });
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
      });
      state = deps.repo.transition(state, next);
      continue;
    }
    deps.repo.beginPhase(state, def.name);
    deps.lifecycle?.onPhaseStart(state, def.name);
    const result = await runSubagentPhase(state, inv, deps, def);
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
      const next = nextPhaseFromResult('code-gen-tdd', def.name, result);
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
    const next = nextPhaseFromResult('code-gen-tdd', def.name, result);
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

async function runSubagentPhase(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  def: PhaseDef
): Promise<PhaseResult> {
  // Build the PhaseRequest
  const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'code-gen-tdd', def.subagent);
  const req: PhaseRequest = {
    runId: state.runId,
    workflow: 'code-gen-tdd',
    phase: def.name,
    projectRoot: inv.projectRoot,
    featureDir: inv.featureDir,
    featureId: inv.featureId,
    promptPath,
    inputs: {
      featureDir: inv.featureDir,
      featureId: inv.featureId,
      workflow: inv.workflow,
      phase: def.name,
      mode: def.isRepair ? 'incremental-fix' : 'normal',
      options: inv.options,
      ...(def.subagent === 'tdd-test-spec'
        ? { testSpecTemplatePath: resolve(deps.ctx.packageRoot, 'templates', 'test_spec_template.md') }
        : {}),
      state: {
        currentPhase: state.currentPhase,
        repairCount: state.repairCount,
        lastPhaseResult: state.lastPhaseResult,
      },
    },
    expectedArtifacts: def.artifacts.map((a) => a.path),
    mode: def.isRepair ? 'incremental-fix' : 'normal',
  };
  try {
    return await runPhaseSubagent(state, req, deps);
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

export const _initial = 'INITIALIZED';
