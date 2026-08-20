/**
 * One-shot workflow helper.
 *
 * Used by skills whose work fits in a single agent invocation
 * (init, knowledge-base, code-question, prd-clarify, influence-menu).
 *
 * Runs a single subagent and validates declared artifacts. Real wiring.
 */

import type { ExecutionState, FeatureDevInvocation, PhaseRequest, PhaseResult } from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';
import { runPhaseSubagent } from './subagent-runner.js';
import { getArtifactsForWorkflow } from './artifacts.js';
import { validateArtifacts } from '../runtime/artifact-validator.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';

export async function oneShot(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const subagent = subagentForWorkflow(inv.workflow);
  const phase = inv.workflow;
  const artifactSpecs = getArtifactsForWorkflow(inv.workflow, inv);
  deps.repo.beginPhase(state, phase);
  const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, inv.workflow, subagent);
  const req: PhaseRequest = {
    runId: state.runId,
    workflow: inv.workflow,
    phase,
    projectRoot: inv.projectRoot,
    featureDir: inv.featureDir,
    featureId: inv.featureId,
    promptPath,
    inputs: {
      featureDir: inv.featureDir,
      featureId: inv.featureId,
      mrdUrl: inv.mrdUrl,
      bugDescription: inv.bugDescription,
      target: inv.target,
      rawUserRequest: inv.rawUserRequest,
      options: inv.options,
      state: { currentPhase: state.currentPhase },
    },
    expectedArtifacts: artifactSpecs.map((artifact) => artifact.path),
    mode: 'normal',
  };
  let result: PhaseResult;
  try {
    result = await runPhaseSubagent(state, req, deps);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    result = {
      status: 'failed',
      summary: `子代理 ${subagent} 执行失败：${detail}`,
      artifacts: [],
      evidence: [`subagent_failure:${subagent}`],
      changedFiles: [],
      blocker: `请解决 ${subagent} 的子模型、提供方或运行时错误后再重试`,
    };
  }
  const validation = validateArtifacts(inv.projectRoot, artifactSpecs);
  if (!validation.ok && artifactSpecs.length > 0) {
    const failures = validation.results.filter((item) => !item.ok);
    result.status = 'failed';
    result.summary += '（必需产物校验失败）';
    result.evidence.push(
      `artifacts_missing:${failures.length}`,
      ...failures.map((item) => `artifact:${item.path}:${item.reason ?? 'invalid'}`)
    );
    result.blocker = '请创建或修复全部必需产物后再继续此工作流';
  }
  deps.repo.endPhase(state, phase, result);
  if (result.status === 'block' || result.status === 'failed') {
    return deps.repo.transition(state, 'BLOCKED');
  }
  state.currentPhase = 'COMPLETED';
  return deps.repo.transition(state, 'COMPLETED');
}

function subagentForWorkflow(workflow: FeatureDevInvocation['workflow']): string {
  // The subagent name MUST point at a real file under `agents/`.
  // We map each one-shot workflow to the role whose prompt is closest
  // to its work:
  //  - init           → init (writes the KB freshness marker)
  //  - knowledge-base → kb-update
  //  - code-question  → code-question
  //  - prd-clarify    → mrd-clarify
  //  - influence-menu → influence-menu
  switch (workflow) {
    case 'init': return 'init';
    case 'knowledge-base': return 'kb-update';
    case 'code-question': return 'code-question';
    case 'prd-clarify': return 'mrd-clarify';
    case 'influence-menu': return 'influence-menu';
    default: return 'code-question';
  }
}
