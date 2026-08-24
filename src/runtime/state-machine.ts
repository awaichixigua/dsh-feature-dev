/**
 * Workflow state machines.
 *
 * We use a tiny declarative DSL: each workflow is a list of (phase, allowedNext).
 * State machine guards *all* phase transitions; tools and subagents cannot
 * directly mutate currentPhase.
 *
 * For the Code Gen TDD workflow the DSL mirrors TECH_DESIGN.md §9.3.
 */

import type { CodeGenPhase, PhaseResult, WorkflowId } from '../types/contracts.js';
import { StateMachineError } from './errors.js';

type Phase = string;
type EdgeMap = Record<Phase, ReadonlySet<Phase>>;

export interface TransitionContext {
  lastResult?: PhaseResult;
  repairCount: number;
  maxRepairAttempts: number;
}

export interface NextPhaseOptions {
  /** Bugfix only: skip test-agent execution when tests were not requested. */
  skipBugfixVerify?: boolean;
  /** Code-gen-tdd: skip unit-test generation and execution. */
  skipCodeGenTddTests?: boolean;
}

const CODE_GEN_TDD_EDGES: EdgeMap = {
  INITIALIZED: new Set(['PHASE1_TEST_SPEC']),
  PHASE1_TEST_SPEC: new Set([
    'AWAITING_TEST_SPEC_CONFIRMATION',
    'PHASE2_IMPLEMENTATION',
  ]),
  AWAITING_TEST_SPEC_CONFIRMATION: new Set([
    'PHASE2_IMPLEMENTATION',
    'PHASE1_TEST_SPEC',
    'BLOCKED',
  ]),
  PHASE2_IMPLEMENTATION: new Set(['PHASE3_REVIEW', 'PHASE2_REPAIR', 'BLOCKED']),
  PHASE2_REPAIR: new Set(['PHASE3_REVIEW', 'BLOCKED']),
  PHASE3_REVIEW: new Set([
    'PHASE4_TEST_GENERATION',
    'PHASE6_SUMMARY',
    'PHASE2_REPAIR',
    'BLOCKED',
  ]),
  PHASE4_TEST_GENERATION: new Set(['PHASE5_TEST_EXECUTION', 'PHASE6_SUMMARY', 'PHASE4_REPAIR', 'BLOCKED']),
  PHASE4_REPAIR: new Set(['PHASE5_TEST_EXECUTION', 'PHASE6_SUMMARY', 'BLOCKED']),
  PHASE5_TEST_EXECUTION: new Set(['PHASE6_SUMMARY', 'PHASE2_REPAIR', 'PHASE4_REPAIR', 'BLOCKED']),
  PHASE6_SUMMARY: new Set(['COMPLETED']),
  COMPLETED: new Set(),
  BLOCKED: new Set(),
  INTERRUPTED: new Set([
    'PHASE1_TEST_SPEC',
    'PHASE2_IMPLEMENTATION',
    'PHASE3_REVIEW',
    'PHASE4_TEST_GENERATION',
    'PHASE5_TEST_EXECUTION',
    'BLOCKED',
  ]),
};

const IMPLEMENTATION_PLAN_EDGES: EdgeMap = {
  INITIALIZED: new Set(['MRD_READER']),
  MRD_READER: new Set(['SERVICE_ROUTER', 'BLOCKED']),
  SERVICE_ROUTER: new Set(['BRANCH_GATE', 'BLOCKED']),
  BRANCH_GATE: new Set(['CLARIFY', 'BLOCKED']),
  CLARIFY: new Set(['PRD', 'BLOCKED']),
  PRD: new Set(['TECH_DESIGN', 'BLOCKED']),
  TECH_DESIGN: new Set(['COMPLETED', 'BLOCKED']),
  COMPLETED: new Set(),
  BLOCKED: new Set(),
  INTERRUPTED: new Set(['MRD_READER', 'SERVICE_ROUTER', 'BRANCH_GATE', 'CLARIFY', 'PRD', 'TECH_DESIGN']),
};

const BUGFIX_EDGES: EdgeMap = {
  INITIALIZED: new Set(['LOCATE', 'BLOCKED']),
  // Fresh LOCATE results choose either targeted document revision or a direct
  // code fix. IMPACT_ANALYSIS remains only for legacy persisted runs.
  LOCATE: new Set(['DOC_REVISION', 'CODE_FIX', 'BLOCKED']),
  IMPACT_ANALYSIS: new Set(['DOC_REVISION', 'BLOCKED']),
  DOC_REVISION: new Set(['CODE_FIX', 'BLOCKED']),
  CODE_FIX: new Set(['VERIFY', 'REPORT', 'BLOCKED']),
  VERIFY: new Set(['REPORT', 'BLOCKED']),
  REPORT: new Set(['COMPLETED', 'BLOCKED']),
  COMPLETED: new Set(),
  BLOCKED: new Set(),
};

const ARCHIVE_EDGES: EdgeMap = {
  INITIALIZED: new Set(['SNAPSHOT', 'BLOCKED']),
  SNAPSHOT: new Set(['FRESHNESS_CHECK', 'BLOCKED']),
  FRESHNESS_CHECK: new Set(['KB_UPDATE', 'BLOCKED']),
  KB_UPDATE: new Set(['REPORT', 'BLOCKED']),
  REPORT: new Set(['COMPLETED', 'BLOCKED']),
  COMPLETED: new Set(),
  BLOCKED: new Set(),
};

const EDGES: Record<WorkflowId, EdgeMap> = {
  'code-gen-tdd': CODE_GEN_TDD_EDGES,
  'implementation-plan': IMPLEMENTATION_PLAN_EDGES,
  bugfix: BUGFIX_EDGES,
  archive: ARCHIVE_EDGES,
  'mrd-to-code': IMPLEMENTATION_PLAN_EDGES, // alias for the orchestrator entry
  'knowledge-base': { INITIALIZED: new Set(['COMPLETED']), COMPLETED: new Set() },
  'prd-clarify': { INITIALIZED: new Set(['COMPLETED']), COMPLETED: new Set() },
  'influence-menu': { INITIALIZED: new Set(['COMPLETED']), COMPLETED: new Set() },
};

export function getInitialPhase(_workflow: WorkflowId): string {
  return 'INITIALIZED';
}

export function getTerminalPhases(_workflow: WorkflowId): string[] {
  return ['COMPLETED', 'BLOCKED'];
}

/**
 * Validate a transition. Throws StateMachineError if illegal.
 */
export function assertTransition(
  workflow: WorkflowId,
  from: Phase,
  to: Phase,
  ctx: TransitionContext
): void {
  const edges = EDGES[workflow];
  if (!edges) {
    throw new StateMachineError(`Unknown workflow: ${workflow}`, { workflow });
  }
  const allowed = edges[from];
  if (!allowed) {
    throw new StateMachineError(`No outgoing edges from phase ${from}`, { workflow, from });
  }
  if (!allowed.has(to)) {
    throw new StateMachineError(`Illegal transition: ${from} -> ${to}`, {
      workflow,
      from,
      to,
      allowed: [...allowed],
    });
  }
  // Repair cap guard
  if (to.endsWith('_REPAIR') || to === 'PHASE2_REPAIR' || to === 'PHASE4_REPAIR') {
    if (ctx.repairCount >= ctx.maxRepairAttempts) {
      throw new StateMachineError('Max repair attempts reached', {
        workflow,
        from,
        to,
        repairCount: ctx.repairCount,
        max: ctx.maxRepairAttempts,
      });
    }
  }
}

/**
 * Compute the next phase based on a PhaseResult.
 * Used by workflows to derive transitions without leaking control logic.
 */
export function nextPhaseFromResult(
  workflow: WorkflowId,
  currentPhase: string,
  result: PhaseResult,
  options: NextPhaseOptions = {}
): string {
  if (result.status === 'failed') {
    return 'BLOCKED';
  }

  // Linear workflows have no repair phase. A blocked phase must stop the
  // workflow immediately; advancing would skip work and could falsely mark the
  // run COMPLETED. Code Gen TDD handles block results through its repair graph.
  if (result.status === 'block' && workflow !== 'code-gen-tdd') {
    return 'BLOCKED';
  }

  if (workflow === 'code-gen-tdd') {
    switch (currentPhase) {
      case 'INITIALIZED':
        return 'PHASE1_TEST_SPEC';
      case 'PHASE1_TEST_SPEC':
        return 'AWAITING_TEST_SPEC_CONFIRMATION';
      case 'AWAITING_TEST_SPEC_CONFIRMATION':
        return 'PHASE2_IMPLEMENTATION';
      case 'PHASE2_IMPLEMENTATION':
        return 'PHASE3_REVIEW';
      case 'PHASE2_REPAIR':
        return 'PHASE3_REVIEW';
      case 'PHASE3_REVIEW':
        return result.status === 'pass' || result.status === 'warn'
          ? (options.skipCodeGenTddTests ? 'PHASE6_SUMMARY' : 'PHASE4_TEST_GENERATION')
          : 'PHASE2_REPAIR';
      case 'PHASE4_TEST_GENERATION':
        return result.status === 'pass' || result.status === 'warn'
          ? (options.skipCodeGenTddTests ? 'PHASE6_SUMMARY' : 'PHASE5_TEST_EXECUTION')
          : 'PHASE4_REPAIR';
      case 'PHASE4_REPAIR':
        return options.skipCodeGenTddTests ? 'PHASE6_SUMMARY' : 'PHASE5_TEST_EXECUTION';
      case 'PHASE5_TEST_EXECUTION':
        if (result.status === 'pass' || result.status === 'warn') {
          return 'PHASE6_SUMMARY';
        }
        // classify the defect from the result summary/evidence
        const isTestDefect = /test[ _-]?defect|spec[ _-]?mismatch|mock[ _-]?wrong/i.test(
          result.summary + ' ' + result.evidence.join(' ')
        );
        return isTestDefect ? 'PHASE4_REPAIR' : 'PHASE2_REPAIR';
      case 'PHASE6_SUMMARY':
        return 'COMPLETED';
    }
  }
  if (workflow === 'implementation-plan' || workflow === 'mrd-to-code') {
    const order = ['INITIALIZED', 'MRD_READER', 'SERVICE_ROUTER', 'BRANCH_GATE', 'CLARIFY', 'PRD', 'TECH_DESIGN', 'COMPLETED'];
    const i = order.indexOf(currentPhase);
    if (i < 0 || i === order.length - 1) return 'BLOCKED';
    return order[i + 1]!;
  }
  if (workflow === 'bugfix') {
    if (currentPhase === 'LOCATE') {
      return result.bugClassification === 'business_requirement'
        ? 'DOC_REVISION'
        : 'CODE_FIX';
    }
    // Compatibility with executions persisted by older releases.
    if (currentPhase === 'IMPACT_ANALYSIS') return 'DOC_REVISION';
    if (currentPhase === 'CODE_FIX') {
      return options.skipBugfixVerify ? 'REPORT' : 'VERIFY';
    }
    const order = ['INITIALIZED', 'LOCATE', 'DOC_REVISION', 'CODE_FIX', 'VERIFY', 'REPORT', 'COMPLETED'];
    const i = order.indexOf(currentPhase);
    if (i < 0 || i === order.length - 1) return 'BLOCKED';
    return order[i + 1]!;
  }
  if (workflow === 'archive') {
    const order = ['INITIALIZED', 'SNAPSHOT', 'FRESHNESS_CHECK', 'KB_UPDATE', 'REPORT', 'COMPLETED'];
    const i = order.indexOf(currentPhase);
    if (i < 0 || i === order.length - 1) return 'BLOCKED';
    return order[i + 1]!;
  }
  return 'COMPLETED';
}

export const _edgesForTest = EDGES;
export const _codeGenPhase = null as unknown as CodeGenPhase; // type export
