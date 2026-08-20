/**
 * Shared phase driver for "linear" workflows (implementation-plan, bugfix, archive).
 *
 * Each phase uses the workflow's lifecycle + state machine. Subagent
 * execution is abstracted by `executePhase`, which would be wired to
 * a real SubagentExecutor in production. The default here is a
 * structured-IO placeholder that emits deterministic PhaseResults
 * for fixtures and offline use.
 */

import type {
  ExecutionState,
  FeatureDevInvocation,
  PhaseResult,
  WorkflowId,
} from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';
import { assertTransition, nextPhaseFromResult } from '../runtime/state-machine.js';
import { validateArtifacts, type ArtifactSpec } from '../runtime/artifact-validator.js';
import { GateEngine, type Gate } from '../runtime/gate-engine.js';
import { relative, resolve, sep } from 'node:path';

export interface PhaseSpec {
  name: string;
  artifacts: ArtifactSpec[] | ((state: ExecutionState) => ArtifactSpec[]);
  gate?: Gate;
  /** A subagent name in the workflow's `agents/<workflow>/` directory (or `agents/shared/`). When set, the driver spawns the subagent
   *  via deps.executor and returns the structured PhaseResult. */
  subagent?: string;
  /** Skip this phase without changing state. Used for conditional branches. */
  shouldSkip?: (state: ExecutionState) => boolean;
  run: (s: ExecutionState, inv: FeatureDevInvocation, deps: RunnerDeps) => Promise<PhaseResult>;
}

export async function drivePhases(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps,
  engine: GateEngine,
  workflow: WorkflowId,
  phases: PhaseSpec[]
): Promise<ExecutionState> {
  if (state.currentPhase === 'BLOCKED' || state.currentPhase === 'INTERRUPTED') {
    return state;
  }
  for (const phase of phases) {
    if (phase.shouldSkip?.(state)) continue;
    // If we've already passed this phase (resume), skip.
    if (isPhasePast(state, phase.name)) continue;
    const target = nextPhaseFromResult(workflow, state.currentPhase, state.lastPhaseResult ?? {
      status: 'pass',
      summary: '阶段调度继续执行',
      artifacts: [],
      evidence: [],
      changedFiles: [],
      ...(state.bugClassification ? { bugClassification: state.bugClassification } : {}),
    }, {
      skipBugfixVerify: workflow === 'bugfix' && state.unitTestsRequested !== true,
    });
    if (target === 'BLOCKED' || target === 'COMPLETED') break;
    assertTransition(workflow, state.currentPhase, target, {
      lastResult: state.lastPhaseResult,
      repairCount: state.repairCount,
      maxRepairAttempts: deps.config.maxRepairAttempts,
    });
    deps.repo.beginPhase(state, target);
    deps.lifecycle?.onPhaseStart(state, target);
    const result = await phase.run(state, inv, deps);
    if (workflow === 'bugfix' && target === 'LOCATE') {
      // Confirmation and retry may clear lastPhaseResult. Preserve the route
      // so a failed DOC_REVISION retry cannot silently skip document work.
      if (result.bugClassification) state.bugClassification = result.bugClassification;
      if (result.status === 'pass' || result.status === 'warn') {
        const selectedDir = state.bugCaseDir ?? result.bugCaseDir;
        if (!isBugCaseDir(selectedDir, inv.featureDir)) {
          result.status = 'block';
          result.summary = `${result.summary}（未解析到缺陷案例目录）`;
          result.evidence.push('bug_case_dir:missing_or_invalid');
          result.blocker = 'LOCATE 必须在修改代码前选择当前的 bugfix/<编号>-<简述> 目录';
        } else if (result.bugCaseDir && result.bugCaseDir !== selectedDir) {
          result.status = 'block';
          result.summary = `${result.summary}（LOCATE 返回的案例目录与本次运行目录不一致）`;
          result.evidence.push(`bug_case_dir:mismatch:${result.bugCaseDir}:${selectedDir}`);
          result.blocker = '请使用本次运行已分配的缺陷案例目录，或以明确的 bugCaseId 新建运行';
        } else {
          state.bugCaseDir = selectedDir;
        }
      }
    }
    const artifacts = typeof phase.artifacts === 'function' ? phase.artifacts(state) : phase.artifacts;
    const valid = validateArtifacts(inv.projectRoot, artifacts);
    if (!valid.ok && artifacts.length > 0) {
      const failures = valid.results.filter((r) => !r.ok);
      result.status = 'failed';
      result.summary = `${result.summary}（必需产物校验失败）`;
      result.evidence.push(
        `artifacts_missing:${failures.length}`,
        ...failures.map((r) => `artifact:${r.path}:${r.reason ?? 'invalid'}`)
      );
      result.blocker = '请创建或修复全部必需产物后再继续此阶段';
    }
    deps.repo.endPhase(state, target, result);
    deps.lifecycle?.onPhaseEnd(state, target, result);

    if (phase.gate && result.status !== 'block' && result.status !== 'failed') {
      const conf = engine.raise(state, phase.gate);
      state.notes = (state.notes ?? []).concat(`Gate ${phase.gate} raised: ${conf.id}`);
      return state;
    }
    if (result.status === 'block' || result.status === 'failed') {
      // Don't go straight to BLOCKED — let the FSM decide the repair path.
      const next = nextPhaseFromResult(workflow, target, result);
      if (next === target || next === 'BLOCKED') {
        return deps.repo.transition(state, 'BLOCKED');
      }
      if (next.endsWith('_REPAIR')) {
        assertTransition(workflow, target, next, {
          lastResult: result,
          repairCount: state.repairCount,
          maxRepairAttempts: deps.config.maxRepairAttempts,
        });
        deps.repo.bumpRepair(state, target, next, result.summary);
      }
      assertTransition(workflow, target, next, {
        lastResult: result,
        repairCount: state.repairCount,
        maxRepairAttempts: deps.config.maxRepairAttempts,
      });
      state = deps.repo.transition(state, next);
      // Continue the loop — the repair phase runs naturally.
      continue;
    }
  }
  return deps.repo.transition(state, 'COMPLETED');
}

function isPhasePast(state: ExecutionState, phase: string): boolean {
  return state.phaseHistory.some((h) => h.phase === phase && (h.status === 'pass' || h.status === 'warn'));
}

function isBugCaseDir(value: string | undefined, featureDir: string | undefined): value is string {
  if (!value || !featureDir) return false;
  const root = resolve(featureDir, 'bugfix');
  const candidate = resolve(featureDir, value);
  const rel = relative(root, candidate);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(sep);
}
