import type { ExecutionState, PhaseRequest, PhaseResult } from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';

/**
 * Reserve one run-global subagent slot and execute a phase.
 * `state.agentCount` is authoritative and survives tool-call boundaries.
 */
export async function runPhaseSubagent(
  state: ExecutionState,
  request: PhaseRequest,
  deps: RunnerDeps
): Promise<PhaseResult> {
  const max = deps.spawnBudget.max;
  if (state.agentCount >= max) {
    return {
      status: 'block',
      summary: `子代理调用额度已耗尽（${state.agentCount}/${max}）`,
      artifacts: [],
      evidence: [`budget:max_total_agents:${max}`],
      changedFiles: [],
      blocker: '请在 cordis.patch.yml 中提高 maxTotalAgents，或缩小本次运行范围',
    };
  }

  state.agentCount += 1;
  deps.spawnBudget.used = state.agentCount;
  deps.repo.writeAtomicPublic(state);
  return deps.executor.run(request, { signal: deps.ctx.signal });
}
