/**
 * Lifecycle ↔ reporter wiring.
 *
 * The Lifecycle is advisory; the reporter is the actual side effect.
 * These tests verify that the right Lifecycle hooks trigger the
 * right reporter calls — and ONLY the right ones:
 *   - onRunStart  → startRun
 *   - onPhaseStart for code-writing phase → startTimer
 *   - onPhaseEnd for the same phase → stopTimer
 *   - onPhaseStart for a non-code phase (e.g. PHASE1_TEST_SPEC) → no timer
 *   - onRunEnd when status === 'completed' → finishRun
 *   - onRunEnd when status === 'blocked' / 'aborted' / 'failed' → no finishRun
 *
 * We use a real (not proxy) class fake reporter that requires `this`
 * to work — the same way the real RunMetricsReporter does — to catch
 * regressions where the lifecycle destructures a method reference
 * and calls it without binding. A previous version of the lifecycle
 * did `const fn = reporter.finishRun; fn(args)` which silently lost
 * `this` and crashed on the real reporter with
 * "Cannot read properties of undefined (reading 'cfg')". The
 * `realClassFake` test below locks that down.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lifecycle, phaseToCategory } from '../../src/runtime/lifecycle.ts';
import type { RunMetricsReporter } from '../../src/metrics/reporter.ts';
import type {
  ExecutionState,
  FeatureDevInvocation,
  PhaseResult,
} from '../../src/types/contracts.ts';

interface RecordedCall {
  method: string;
  args: unknown;
}

/**
 * Build a fake reporter that records every call. This is a real
 * class, NOT a Proxy — so its methods rely on `this` being bound
 * by the caller. If the lifecycle ever calls a method as an
 * unbound function, `this` will be undefined and the methods that
 * read `this.calls` will throw — exactly the failure mode we want
 * to surface.
 */
class RealClassFakeReporter {
  public readonly calls: RecordedCall[] = [];
  // The properties a real reporter exposes; we touch `this.calls` in
  // every method so an unbound call blows up immediately.
  startRun(args: unknown): { run_id: string; status: 'in_progress' } {
    this.calls.push({ method: 'startRun', args });
    return { run_id: 'fake', status: 'in_progress' };
  }
  startTimer(args: unknown): { category: string } {
    this.calls.push({ method: 'startTimer', args });
    return { category: (args as { category: string }).category };
  }
  stopTimer(args: unknown): { category: string } {
    this.calls.push({ method: 'stopTimer', args });
    return { category: (args as { category: string }).category };
  }
  async finishRun(args: unknown): Promise<{ run_id: string; status: 'reported' }> {
    this.calls.push({ method: 'finishRun', args });
    return { run_id: 'fake', status: 'reported' };
  }
  async flushQueue(): Promise<{ processed: number; results: unknown[] }> {
    return { processed: 0, results: [] };
  }
}

function makeFakeReporter(): { reporter: RunMetricsReporter; calls: RecordedCall[] } {
  const fake = new RealClassFakeReporter();
  return { reporter: fake as unknown as RunMetricsReporter, calls: fake.calls };
}

function makeState(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    schemaVersion: '1.0.0',
    runId: 'run-1',
    workflow: 'code-gen-tdd',
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

function makeInvocation(overrides: Partial<FeatureDevInvocation> = {}): FeatureDevInvocation {
  return {
    workflow: 'code-gen-tdd',
    projectRoot: '/p',
    featureDir: '/p/req/foo',
    options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
    ...overrides,
  };
}

void test('phaseToCategory maps code-writing phases correctly', () => {
  assert.equal(phaseToCategory('PHASE2_IMPLEMENTATION'), 'implementation');
  assert.equal(phaseToCategory('PHASE2_REPAIR'), 'implementation');
  assert.equal(phaseToCategory('PHASE4_TEST_GENERATION'), 'test_generation');
  assert.equal(phaseToCategory('PHASE4_REPAIR'), 'test_generation');
  // Non-code phases
  assert.equal(phaseToCategory('PHASE1_TEST_SPEC'), null);
  assert.equal(phaseToCategory('PHASE3_REVIEW'), null);
  assert.equal(phaseToCategory('PHASE6_SUMMARY'), null);
  assert.equal(phaseToCategory('COMPLETED'), null);
});

void test('onRunStart kicks the reporter once', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  lc.onRunStart(makeState(), makeInvocation());
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'startRun');
});

void test('onPhaseStart on a code-writing phase starts a timer', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  lc.onPhaseStart(makeState({ currentPhase: 'PHASE2_IMPLEMENTATION' }), 'PHASE2_IMPLEMENTATION');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'startTimer');
});

void test('onPhaseStart on a non-code phase is a no-op for the reporter', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  lc.onPhaseStart(makeState({ currentPhase: 'PHASE6_SUMMARY' }), 'PHASE6_SUMMARY');
  assert.equal(calls.length, 0);
});

void test('onPhaseEnd on a code-writing phase stops the timer', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  const result: PhaseResult = {
    status: 'pass', summary: 'ok', artifacts: [], evidence: ['e1'], changedFiles: [],
  };
  lc.onPhaseEnd(makeState(), 'PHASE2_IMPLEMENTATION', result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'stopTimer');
});

void test('onRunEnd on completed run calls finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  await lc.onRunEnd(makeState({ status: 'completed' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'finishRun');
});

void test('onRunEnd on blocked run does NOT call finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  await lc.onRunEnd(makeState({ status: 'blocked' }));
  assert.equal(calls.length, 0);
});

void test('onRunEnd on aborted run does NOT call finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  await lc.onRunEnd(makeState({ status: 'aborted' }));
  assert.equal(calls.length, 0);
});

void test('onRunEnd on failed run does NOT call finishRun', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  await lc.onRunEnd(makeState({ status: 'failed' }));
  assert.equal(calls.length, 0);
});

void test('reporter is skipped when workflow is not in the allow-list', () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({
    repo: undefined as never,
    strictGates: false,
    metricsReporter: reporter,
    metricsWorkflows: new Set(['bugfix']), // code-gen-tdd not allowed
  });
  lc.onRunStart(makeState({ workflow: 'code-gen-tdd' }), makeInvocation());
  lc.onPhaseStart(makeState({ workflow: 'code-gen-tdd', currentPhase: 'PHASE2_IMPLEMENTATION' }), 'PHASE2_IMPLEMENTATION');
  assert.equal(calls.length, 0);
});

void test('reporter is skipped when none is configured (no-op for every hook)', () => {
  const calls: string[] = [];
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false });
  // Wrap state in a proxy that records every field access — the lifecycle
  // should never call any reporter method.
  lc.onRunStart(makeState(), makeInvocation());
  lc.onPhaseStart(makeState(), 'PHASE2_IMPLEMENTATION');
  const r: PhaseResult = {
    status: 'pass', summary: 'ok', artifacts: [], evidence: ['e1'], changedFiles: [],
  };
  lc.onPhaseEnd(makeState(), 'PHASE2_IMPLEMENTATION', r);
  assert.deepEqual(calls, []);
});

void test('reporter error is caught and recorded as a note, not rethrown', async () => {
  const errReporter = {
    startRun: () => { throw new Error('boom'); },
    startTimer: () => { throw new Error('boom'); },
    stopTimer: () => { throw new Error('boom'); },
    finishRun: () => { throw new Error('boom'); },
    flushQueue: () => Promise.resolve({ processed: 0, results: [] }),
  } as unknown as RunMetricsReporter;
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: errReporter });
  const state = makeState();
  // Should NOT throw, even though every reporter call would.
  lc.onRunStart(state, makeInvocation());
  lc.onPhaseStart(state, 'PHASE2_IMPLEMENTATION');
  const r: PhaseResult = {
    status: 'pass', summary: 'ok', artifacts: [], evidence: ['e1'], changedFiles: [],
  };
  lc.onPhaseEnd(state, 'PHASE2_IMPLEMENTATION', r);
  // Mutate the same state reference so the lifecycle's appendMetricError
  // call lands in the array we read at the end. (We can't just spread —
  // spread creates a new object whose .notes won't be the same array.)
  state.status = 'completed';
  await lc.onRunEnd(state);
  // Notes should contain 4 metrics: lines, one per failed hook.
  const notes = state.notes ?? [];
  assert.ok(notes.some((n) => n.startsWith('metrics:start:')), `notes=${JSON.stringify(notes)}`);
  assert.ok(notes.some((n) => n.startsWith('metrics:timer-start:')), `notes=${JSON.stringify(notes)}`);
  assert.ok(notes.some((n) => n.startsWith('metrics:timer-stop:')), `notes=${JSON.stringify(notes)}`);
  assert.ok(notes.some((n) => n.startsWith('metrics:finish:')), `notes=${JSON.stringify(notes)}`);
});

/**
 * Regression test for the `this`-loss bug. A previous version of
 * safeMetricsFinish saved `this.deps.metricsReporter.finishRun` into
 * a `const fn` and then called `fn(args)`. That call was an unbound
 * method invocation, so the real reporter saw `this === undefined`
 * and threw "Cannot read properties of undefined (reading 'cfg')".
 * A proxy fake did not surface the bug because every property access
 * returned a generic function. The RealClassFakeReporter above
 * closes that gap: it touches `this.calls` in every method, so an
 * unbound call throws synchronously and the test fails.
 */
void test('regression: lifecycle must call reporter methods through the object reference, not a destructured alias', async () => {
  const { reporter, calls } = makeFakeReporter();
  const lc = new Lifecycle({ repo: undefined as never, strictGates: false, metricsReporter: reporter });
  const state = makeState();
  // Every code-writing hook + run start/end must succeed without
  // throwing inside the reporter. With the old `const fn = ...`
  // pattern, the unbound `fn(args)` call would crash here.
  lc.onRunStart(state, makeInvocation());
  lc.onPhaseStart(state, 'PHASE2_IMPLEMENTATION');
  const r: PhaseResult = {
    status: 'pass', summary: 'ok', artifacts: [], evidence: ['e1'], changedFiles: [],
  };
  lc.onPhaseEnd(state, 'PHASE2_IMPLEMENTATION', r);
  state.status = 'completed';
  await lc.onRunEnd(state);
  assert.ok(
    calls.some((c) => c.method === 'startRun'),
    `expected startRun, got calls=${JSON.stringify(calls)}`
  );
  assert.ok(
    calls.some((c) => c.method === 'startTimer'),
    `expected startTimer, got calls=${JSON.stringify(calls)}`
  );
  assert.ok(
    calls.some((c) => c.method === 'stopTimer'),
    `expected stopTimer, got calls=${JSON.stringify(calls)}`
  );
  assert.ok(
    calls.some((c) => c.method === 'finishRun'),
    `expected finishRun, got calls=${JSON.stringify(calls)}`
  );
});
