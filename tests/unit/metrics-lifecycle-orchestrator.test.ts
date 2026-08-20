/**
 * Lifecycle ↔ reporter wiring for orchestrator workflows.
 *
 * mrd-to-code is an orchestrator: state.workflow stays 'mrd-to-code'
 * throughout, but state.activeWorkflow points at the sub-workflow
 * (code-gen-tdd, archive) that is currently dispatching. The metrics
 * reporter must:
 *   - be enabled when the sub-workflow is enabled (so phase hooks fire)
 *   - treat the runType as the sub-workflow's type (so a code-gen sub-flow
 *     inside mrd-to-code is still reported as code_gen)
 *   - fire finishRun on the orchestrator's COMPLETED transition
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lifecycle, deriveBugIdFromDescription } from '../../src/runtime/lifecycle.ts';
import type { RunMetricsReporter } from '../../src/metrics/reporter.ts';
import type {
  ExecutionState,
  FeatureDevInvocation,
  PhaseResult,
} from '../../src/types/contracts.ts';

interface RecordedCall { method: string; args: Record<string, unknown>; }

function makeFakeReporter(): { reporter: RunMetricsReporter; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fake = {
    startRun: (args: Record<string, unknown>) => {
      calls.push({ method: 'startRun', args });
      return Promise.resolve({ run_id: 'fake', status: 'reported' });
    },
    startTimer: (args: Record<string, unknown>) => {
      calls.push({ method: 'startTimer', args });
      return Promise.resolve({ status: 'reported' });
    },
    stopTimer: (args: Record<string, unknown>) => {
      calls.push({ method: 'stopTimer', args });
      return Promise.resolve({ status: 'reported' });
    },
    finishRun: async (args: Record<string, unknown>) => {
      calls.push({ method: 'finishRun', args });
      return { run_id: 'fake', status: 'reported' };
    },
    flushQueue: async () => ({ processed: 0, results: [] }),
  } as unknown as RunMetricsReporter;
  return { reporter: fake, calls };
}

function makeState(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    schemaVersion: '1.0.0',
    runId: 'run-orch-1',
    workflow: 'mrd-to-code',
    activeWorkflow: 'code-gen-tdd',
    orchestratorWorkflow: 'mrd-to-code',
    projectRoot: '/p',
    featureDir: '/p/req/foo',
    currentPhase: 'PHASE2_IMPLEMENTATION',
    phaseHistory: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    repairCount: 0,
    agentCount: 0,
    pendingConfirmations: [],
    ...overrides,
  };
}

void test('mrd-to-code + activeWorkflow=code-gen-tdd is metrics-enabled', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
  });
  lc.onPhaseStart(
    makeState({ workflow: 'mrd-to-code', activeWorkflow: 'code-gen-tdd', currentPhase: 'PHASE2_IMPLEMENTATION' }),
    'PHASE2_IMPLEMENTATION',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'startTimer');
  // The timer args should classify the run as code_gen (from activeWorkflow)
  assert.equal(calls[0]!.args.runType, 'code_gen');
});

void test('mrd-to-code + activeWorkflow=archive is NOT metrics-enabled', () => {
  // archive is not in the default allow-list, so the lifecycle must
  // skip the timer for archive phases. (The orchestrator still gets
  // its own finishRun at the very end — that's a different test.)
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
    metricsWorkflows: new Set(['code-gen-tdd', 'bugfix']),
  });
  lc.onPhaseStart(
    makeState({ workflow: 'mrd-to-code', activeWorkflow: 'archive', currentPhase: 'SNAPSHOT' }),
    'SNAPSHOT',
  );
  assert.equal(calls.length, 0);
});

void test('mrd-to-code at the orchestrator end (activeWorkflow=undefined) still fires finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
    metricsWorkflows: new Set(['code-gen-tdd', 'bugfix']),
  });
  // mrd-to-code is COMPLETED with no active sub-workflow — the moment
  // when the orchestrator's own run-end must dispatch finishRun.
  await lc.onRunEnd(makeState({ workflow: 'mrd-to-code', activeWorkflow: undefined, status: 'completed' }));
  assert.equal(calls.some((c) => c.method === 'finishRun'), true);
});

void test('mrd-to-code blocked still does NOT fire finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
  });
  await lc.onRunEnd(makeState({ workflow: 'mrd-to-code', activeWorkflow: undefined, status: 'blocked' }));
  assert.equal(calls.length, 0);
});

void test('deriveBugIdFromDescription produces a stable, anonymised id', () => {
  const a = deriveBugIdFromDescription('login form returns 500 on empty username');
  const b = deriveBugIdFromDescription('login form returns 500 on empty username');
  const c = deriveBugIdFromDescription('different bug');
  assert.equal(a, b, 'same description must hash identically');
  assert.notEqual(a, c);
  assert.match(a, /^bug-[0-9a-f]{8}$/);
});

void test('deriveBugIdFromDescription returns a sentinel for empty input', () => {
  assert.equal(deriveBugIdFromDescription(''), 'bug-00000000');
  assert.equal(deriveBugIdFromDescription(null), 'bug-00000000');
  assert.equal(deriveBugIdFromDescription(undefined), 'bug-00000000');
});

void test('lifecycle forwards bugId derived from bugDescription on a bugfix run', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
    metricsWorkflows: new Set(['bugfix']),
  });
  const inv: FeatureDevInvocation = {
    workflow: 'bugfix',
    projectRoot: '/p',
    featureDir: '/p/req/foo',
    options: { resume: false, unitTests: false, generateUnitTestsOnly: false },
  };
  const state = makeState({
    workflow: 'bugfix',
    activeWorkflow: undefined,
    orchestratorWorkflow: undefined,
    bugDescription: 'login fails on empty username',
  });
  lc.onRunStart(state, inv);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'startRun');
  assert.match(calls[0]!.args.bugId as string, /^bug-[0-9a-f]{8}$/);
  assert.equal(calls[0]!.args.runType, 'bugfix');
});

void test('lifecycle onPhaseEnd with a code-writing phase stops the timer', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
  });
  const result: PhaseResult = {
    status: 'pass', summary: 'ok', artifacts: [], evidence: ['e1'], changedFiles: [],
  };
  lc.onPhaseEnd(
    makeState({ workflow: 'mrd-to-code', activeWorkflow: 'code-gen-tdd', currentPhase: 'PHASE2_IMPLEMENTATION' }),
    'PHASE2_IMPLEMENTATION',
    result,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'stopTimer');
});
