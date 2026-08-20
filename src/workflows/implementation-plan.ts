/**
 * Implementation Plan workflow.
 *
 * Phases: INITIALIZED -> MRD_READER -> CLARIFY -> SERVICE_ROUTER -> PRD -> TECH_DESIGN -> COMPLETED
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
import { resolve } from 'node:path';
import { runPhaseSubagent } from './subagent-runner.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';

export async function implementationPlan(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const featureDir = inv.featureDir ?? inv.projectRoot;

  const phases: PhaseSpec[] = [
    {
      name: 'MRD_READER',
      artifacts: [{ path: `${featureDir}/mrd-original.md`, minSize: 1 }],
      subagent: 'mrd-reader',
      run: makeRunner('mrd-reader'),
    },
    {
      name: 'CLARIFY',
      artifacts: [],
      subagent: 'mrd-clarify',
      run: makeRunner('mrd-clarify'),
    },
    {
      name: 'SERVICE_ROUTER',
      artifacts: [],
      subagent: 'app-router',
      run: makeRunner('app-router'),
    },
    {
      name: 'PRD',
      artifacts: [{ path: `${featureDir}/prd.md`, minSize: 200, mustContain: ['# '] }],
      gate: 'pre_prd',
      subagent: 'prd-generator',
      run: makeRunner('prd-generator'),
    },
    {
      name: 'TECH_DESIGN',
      artifacts: [
        { path: `${featureDir}/tech-design.md`, minSize: 200, mustContain: ['# '] },
      ],
      gate: 'pre_tech_design',
      subagent: 'tech-design',
      run: makeRunner('tech-design'),
    },
  ];
  return drivePhases(state, inv, deps, engine, 'implementation-plan', phases);
}

/** Build a phase.run that invokes the named subagent. */
function makeRunner(subagent: string) {
  return async (state: ExecutionState, inv: FeatureDevInvocation, deps: RunnerDeps): Promise<PhaseResult> => {
    const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'implementation-plan', subagent);
    const req: PhaseRequest = {
      runId: state.runId,
      workflow: 'implementation-plan',
      phase: inferPhaseFromSubagent(subagent),
      projectRoot: inv.projectRoot,
      featureDir: inv.featureDir,
      featureId: inv.featureId,
      promptPath,
      inputs: {
        featureDir: inv.featureDir,
        featureId: inv.featureId,
        mrdUrl: inv.mrdUrl,
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

function inferPhaseFromSubagent(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
