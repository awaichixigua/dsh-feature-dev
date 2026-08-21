/**
 * Workflow runner — dispatches to the workflow-specific implementation.
 *
 * The runner is the entry point used by both `feature_dev_run` and
 * `feature_dev_resume`. It:
 *  1. Picks a workflow by `inv.workflow`
 *  2. Calls `workflow.start()` with the current state
 *  3. Returns the final state
 *
 * The runner is intentionally thin. Each workflow implementation lives
 * in its own file and owns its phases.
 */

import type { ExecutionState, FeatureDevInvocation } from '../types/contracts.js';
import type { StateRepository } from '../runtime/state-repository.js';
import type { ToolContext } from '../tools/contract.js';
import type { SubagentExecutor } from '../executors/protocol.js';
import type { DshFeatureDevConfig } from '../config.js';
import type { Lifecycle } from '../runtime/lifecycle.js';
import { codeGenTdd } from './code-gen-tdd.js';
import { implementationPlan } from './implementation-plan.js';
import { bugfix } from './bugfix.js';
import { archive } from './archive.js';
import { mrdToCode } from './mrd-to-code.js';
import { oneShot } from './one-shot.js';

export interface RunnerDeps {
  ctx: ToolContext;
  /**
   * The implementation-plan flow starts in an MRD hash staging directory and
   * switches this repository to the routed service requirement directory
   * after the service branch gate passes, before MRD clarification begins.
   */
  repo: StateRepository;
  created: boolean;
  /** Configured subagent executor. Required for workflows that spawn agents. */
  executor: SubagentExecutor;
  /** Resolved plugin config. The workflow driver uses it for strictGates / maxRepairAttempts. */
  config: DshFeatureDevConfig;
  /** Soft limit on total subagents in this run. Enforced by the runner. */
  spawnBudget: { used: number; max: number };
  /**
   * Lifecycle instance. Optional so unit tests that only care about the
   * state machine can omit it. When set, workflow drivers (phase-driver
   * + code-gen-tdd) call onPhaseStart / onPhaseEnd around every phase
   * transition. The metrics reporter is plugged in here, so phase
   * timers / finishRun all flow through one choke point.
   */
  lifecycle?: Lifecycle;
}

export async function runWorkflow(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  switch (inv.workflow) {
    case 'code-gen-tdd':
      return codeGenTdd(state, inv, deps);
    case 'implementation-plan':
      return implementationPlan(state, inv, deps);
    case 'mrd-to-code':
      return mrdToCode(state, inv, deps);
    case 'bugfix':
      return bugfix(state, inv, deps);
    case 'archive':
      return archive(state, inv, deps);
    case 'knowledge-base':
    case 'prd-clarify':
    case 'influence-menu':
      return oneShot(state, inv, deps);
    default:
      state.status = 'completed';
      return deps.repo.transition(state, 'COMPLETED');
  }
}
