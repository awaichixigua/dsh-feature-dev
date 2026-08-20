/**
 * Bugfix workflow.
 *
 * Phases: INITIALIZED -> LOCATE -> (DOC_REVISION | CODE_FIX) -> VERIFY ->
 *         REPORT -> COMPLETED. Only a business-requirement gap invokes the
 * document-revision agent.
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
import { isAbsolute, resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { runPhaseSubagent } from './subagent-runner.js';
import type { ArtifactSpec } from '../runtime/artifact-validator.js';
import { resolveAgentPromptPath } from './agent-prompt-path.js';

export async function bugfix(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  const engine = new GateEngine(deps.repo, deps.config.strictGates);
  const plan: Array<{
    name: string;
    subagent: string;
    shouldSkip?: (state: ExecutionState) => boolean;
  }> = [
    // LOCATE is diagnostic only, but a successful classification proceeds
    // automatically into the appropriate repair branch.
    { name: 'LOCATE', subagent: 'bugfix-locate' },
    {
      name: 'DOC_REVISION',
      subagent: 'prd-generator',
      shouldSkip: (state) => !shouldRunDocRevision(state),
    },
    { name: 'CODE_FIX', subagent: 'bugfix-fix' },
    {
      name: 'VERIFY',
      subagent: 'tdd-test-runner',
      shouldSkip: (state) => state.unitTestsRequested !== true,
    },
    { name: 'REPORT', subagent: 'bugfix-report' },
  ];
  const phases: PhaseSpec[] = plan.map((p) => ({
    name: p.name,
    artifacts: p.name === 'REPORT' ? (s) => bugfixReportArtifacts(s) : [],
    subagent: p.subagent,
    shouldSkip: p.shouldSkip,
    run: makeRunner(p.subagent, inv, p.name === 'REPORT' ? (s) => bugfixReportArtifacts(s).map((a) => a.path) : []),
  }));
  return drivePhases(state, inv, deps, engine, 'bugfix', phases);
}

/** Only an explicit business-requirement classification permits doc edits. */
export function shouldRunDocRevision(state: ExecutionState): boolean {
  // Old runs can remain at IMPACT_ANALYSIS; let them finish safely after an
  // upgrade even though new runs never enter that phase.
  return state.currentPhase === 'IMPACT_ANALYSIS'
    || state.bugClassification === 'business_requirement'
    || state.lastPhaseResult?.bugClassification === 'business_requirement';
}

function bugfixReportArtifacts(state: ExecutionState): ArtifactSpec[] {
  return state.bugCaseDir
    ? [{ path: `${state.featureDir}/${state.bugCaseDir}/bugfix-report.md`, minSize: 100 }]
    : [];
}

function makeRunner(
  subagent: string,
  inv: FeatureDevInvocation,
  expectedArtifacts: string[] | ((state: ExecutionState) => string[])
) {
  return async (state: ExecutionState, _inv: FeatureDevInvocation, deps: RunnerDeps): Promise<PhaseResult> => {
    const promptPath = resolveAgentPromptPath(deps.ctx.packageRoot, 'bugfix', subagent);
    const req: PhaseRequest = {
      runId: state.runId,
      workflow: 'bugfix',
      phase: subagent,
      projectRoot: inv.projectRoot,
      featureDir: inv.featureDir,
      featureId: inv.featureId,
      promptPath,
      inputs: {
        featureDir: inv.featureDir,
        featureId: inv.featureId,
        bugDescription: inv.bugDescription,
        options: inv.options,
        state: {
          currentPhase: state.currentPhase,
          repairCount: state.repairCount,
          bugCaseDir: state.bugCaseDir,
        },
      },
      expectedArtifacts: typeof expectedArtifacts === 'function' ? expectedArtifacts(state) : expectedArtifacts,
      mode: 'normal',
    };
    try {
      const result = await runPhaseSubagent(state, req, deps);
      // Versions prior to the per-case report design asked CODE_FIX to write
      // ai/bugfix-locate.json. It is an ambiguous, stale snapshot outside the
      // numbered bug case, so actively remove it even if an old prompt/model
      // attempts to recreate it. Execution state and the JSONL event log are
      // the authoritative audit records.
      if (subagent === 'bugfix-locate' || subagent === 'bugfix-fix') {
        removeLegacyLocateArtifact(inv.featureDir, result);
      }
      return result;
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

function removeLegacyLocateArtifact(featureDir: string | undefined, result: PhaseResult): void {
  if (!featureDir) return;
  const legacyPath = resolve(featureDir, 'ai', 'bugfix-locate.json');
  const normalized = (value: string) => resolve(isAbsolute(value) ? value : resolve(featureDir, value)).toLowerCase();
  result.artifacts = result.artifacts.filter((artifact) => normalized(artifact) !== legacyPath.toLowerCase());
  if (existsSync(legacyPath)) {
    rmSync(legacyPath, { force: true });
    result.evidence.push('cleanup:已移除废弃的 ai/bugfix-locate.json');
  }
}
