/**
 * Archive workflow.
 *
 * Phases: INITIALIZED -> SNAPSHOT -> FRESHNESS_CHECK -> KB_UPDATE -> REPORT -> COMPLETED.
 *
 * Each phase runs a real Subagent via `RunnerDeps.executor`.
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
import { getArtifactsForWorkflow } from './artifacts.js';
import { runPhaseSubagent } from './subagent-runner.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';

export async function archive(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const plan = [
    { name: 'SNAPSHOT', subagent: 'archive-report' },
    { name: 'FRESHNESS_CHECK', subagent: 'kb-update' },
    { name: 'KB_UPDATE', subagent: 'kb-update' },
    { name: 'REPORT', subagent: 'archive-report' },
  ];
  const reportArtifacts = getArtifactsForWorkflow('archive', inv);
  const phases: PhaseSpec[] = plan.map((p) => ({
    name: p.name,
    artifacts: p.name === 'REPORT' ? reportArtifacts : [],
    subagent: p.subagent,
    run: makeRunner(p.subagent, inv, p.name === 'REPORT' ? reportArtifacts.map((a) => a.path) : []),
  }));
  return drivePhases(state, inv, deps, engine, 'archive', phases);
}

function makeRunner(subagent: string, inv: FeatureDevInvocation, expectedArtifacts: string[]) {
  return async (state: ExecutionState, _inv: FeatureDevInvocation, deps: RunnerDeps): Promise<PhaseResult> => {
    const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'archive', subagent);
    const req: PhaseRequest = {
      runId: state.runId,
      workflow: 'archive',
      phase: subagent,
      projectRoot: inv.projectRoot,
      featureDir: inv.featureDir,
      featureId: inv.featureId,
      promptPath,
      inputs: {
        featureDir: inv.featureDir,
        featureId: inv.featureId,
        options: inv.options,
        state: { currentPhase: state.currentPhase },
      },
      expectedArtifacts,
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
