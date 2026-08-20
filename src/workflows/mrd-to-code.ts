/**
 * mrd-to-code meta-workflow.
 *
 * Orchestrates implementation-plan -> code-gen-tdd -> archive while
 * keeping one root execution state and one complete phase history.
 */

import type { ExecutionState, FeatureDevInvocation, WorkflowId } from '../types/contracts.js';
import type { RunnerDeps } from './runner.js';
import { implementationPlan } from './implementation-plan.js';
import { codeGenTdd } from './code-gen-tdd.js';
import { archive } from './archive.js';

type SubWorkflow = Extract<WorkflowId, 'implementation-plan' | 'code-gen-tdd' | 'archive'>;

const SUB_WORKFLOWS: readonly SubWorkflow[] = [
  'implementation-plan',
  'code-gen-tdd',
  'archive',
];

export async function mrdToCode(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  if (!state.activeWorkflow) {
    state.activeWorkflow = 'implementation-plan';
    state.orchestratorWorkflow = 'mrd-to-code';
    state.currentPhase = 'INITIALIZED';
    state.lastPhaseResult = undefined;
    state.status = 'running';
    deps.repo.writeAtomicPublic(state);
  }

  // One tool call may complete a sub-workflow and enter the next one.
  // Gates and blocked states return immediately; only archive completion
  // is allowed to complete the root run.
  while (state.activeWorkflow && isSubWorkflow(state.activeWorkflow)) {
    const completedWorkflow = state.activeWorkflow;
    state = await dispatch(state, inv, deps);
    if (state.currentPhase !== 'COMPLETED') return state;

    const next = nextSubWorkflow(completedWorkflow);
    if (!next) {
      // Clear activeWorkflow first so the repository recognizes this as
      // the single root-level terminal transition and emits one run_end.
      state.activeWorkflow = undefined;
      state.workflow = 'mrd-to-code';
      state.status = 'running';
      deps.repo.writeAtomicPublic(state);
      return deps.repo.transition(state, 'COMPLETED');
    }

    state.workflow = 'mrd-to-code';
    state.status = 'running';
    state.activeWorkflow = next;
    state.currentPhase = 'INITIALIZED';
    state.lastPhaseResult = undefined;
    deps.repo.writeAtomicPublic(state);
  }

  return state;
}

function dispatch(
  state: ExecutionState,
  inv: FeatureDevInvocation,
  deps: RunnerDeps
): Promise<ExecutionState> {
  switch (state.activeWorkflow) {
    case 'implementation-plan':
      return implementationPlan(state, inv, deps);
    case 'code-gen-tdd':
      return codeGenTdd(state, inv, deps);
    case 'archive':
      return archive(state, inv, deps);
    default:
      throw new Error(`Invalid mrd-to-code activeWorkflow: ${String(state.activeWorkflow)}`);
  }
}

function isSubWorkflow(workflow: WorkflowId | undefined): workflow is SubWorkflow {
  return workflow !== undefined && (SUB_WORKFLOWS as readonly string[]).includes(workflow);
}

function nextSubWorkflow(workflow: SubWorkflow): SubWorkflow | undefined {
  const index = SUB_WORKFLOWS.indexOf(workflow);
  if (index < 0 || index === SUB_WORKFLOWS.length - 1) return undefined;
  return SUB_WORKFLOWS[index + 1];
}
