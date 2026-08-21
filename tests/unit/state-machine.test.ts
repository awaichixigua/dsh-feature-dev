/**
 * Unit tests for the workflow state machine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTransition,
  nextPhaseFromResult,
  getInitialPhase,
  getTerminalPhases,
  _edgesForTest,
} from '../../src/runtime/state-machine.ts';

void test('INITIAL -> PHASE1_TEST_SPEC is legal for code-gen-tdd', () => {
  assertTransition('code-gen-tdd', 'INITIALIZED', 'PHASE1_TEST_SPEC', {
    repairCount: 0,
    maxRepairAttempts: 3,
  });
});

void test('PHASE3_REVIEW -> PHASE2_REPAIR is legal (block)', () => {
  assertTransition('code-gen-tdd', 'PHASE3_REVIEW', 'PHASE2_REPAIR', {
    repairCount: 0,
    maxRepairAttempts: 3,
  });
});

void test('PHASE3_REVIEW -> COMPLETED is illegal', () => {
  assert.throws(
    () =>
      assertTransition('code-gen-tdd', 'PHASE3_REVIEW', 'COMPLETED', {
        repairCount: 0,
        maxRepairAttempts: 3,
      }),
    /Illegal transition/
  );
});

void test('Repair cap: PHASE2_REPAIR at maxRepairAttempts throws', () => {
  assert.throws(
    () =>
      assertTransition('code-gen-tdd', 'PHASE3_REVIEW', 'PHASE2_REPAIR', {
        repairCount: 3,
        maxRepairAttempts: 3,
      }),
    /Max repair attempts reached/
  );
});

void test('nextPhaseFromResult: PHASE5 test defect routes to PHASE4_REPAIR', () => {
  const next = nextPhaseFromResult('code-gen-tdd', 'PHASE5_TEST_EXECUTION', {
    status: 'block',
    summary: 'test_defect: spec mismatch in OrderServiceTest.charge',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(next, 'PHASE4_REPAIR');
});

void test('nextPhaseFromResult: PHASE5 production defect routes to PHASE2_REPAIR', () => {
  const next = nextPhaseFromResult('code-gen-tdd', 'PHASE5_TEST_EXECUTION', {
    status: 'block',
    summary: 'production_defect: OrderService.charge returns null on timeout',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(next, 'PHASE2_REPAIR');
});

void test('nextPhaseFromResult: PHASE3 pass routes to PHASE4_TEST_GENERATION', () => {
  const next = nextPhaseFromResult('code-gen-tdd', 'PHASE3_REVIEW', {
    status: 'pass',
    summary: 'review ok',
    artifacts: [],
    evidence: ['ok'],
    changedFiles: [],
  });
  assert.equal(next, 'PHASE4_TEST_GENERATION');
});

void test('nextPhaseFromResult: implementation-plan order', () => {
  let p = getInitialPhase('implementation-plan');
  assert.equal(p, 'INITIALIZED');
  p = nextPhaseFromResult('implementation-plan', p, {
    status: 'pass',
    summary: '',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(p, 'MRD_READER');
  p = nextPhaseFromResult('implementation-plan', p, {
    status: 'pass',
    summary: '',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(p, 'CLARIFY');
  p = nextPhaseFromResult('implementation-plan', p, {
    status: 'pass',
    summary: '',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(p, 'SERVICE_ROUTER');
  p = nextPhaseFromResult('implementation-plan', p, {
    status: 'pass',
    summary: '',
    artifacts: [],
    evidence: [],
    changedFiles: [],
  });
  assert.equal(p, 'BRANCH_GATE');
});

void test('nextPhaseFromResult: a blocked linear workflow stops immediately', () => {
  for (const workflow of ['implementation-plan', 'bugfix', 'archive'] as const) {
    const phase = workflow === 'implementation-plan'
      ? 'MRD_READER'
      : workflow === 'bugfix'
        ? 'LOCATE'
        : 'SNAPSHOT';
    assert.equal(nextPhaseFromResult(workflow, phase, {
      status: 'block',
      summary: 'cannot continue',
      artifacts: [],
      evidence: [],
      changedFiles: [],
      blocker: 'fix the prerequisite',
    }), 'BLOCKED');
  }
});

void test('bugfix LOCATE routes code defects directly to CODE_FIX', () => {
  const next = nextPhaseFromResult('bugfix', 'LOCATE', {
    status: 'pass', summary: 'existing implementation is wrong', artifacts: [],
    evidence: ['file:src/Service.java:42'], changedFiles: [], bugClassification: 'code_defect',
  });
  assert.equal(next, 'CODE_FIX');
});

void test('bugfix LOCATE routes business requirement gaps to DOC_REVISION', () => {
  const next = nextPhaseFromResult('bugfix', 'LOCATE', {
    status: 'pass', summary: 'acceptance rule is missing', artifacts: [],
    evidence: ['prd:acceptance criteria'], changedFiles: [], bugClassification: 'business_requirement',
  });
  assert.equal(next, 'DOC_REVISION');
});

void test('bugfix CODE_FIX skips VERIFY when unit tests were not requested', () => {
  const result = { status: 'pass' as const, summary: 'fixed', artifacts: [], evidence: ['file:x'], changedFiles: [] };
  assert.equal(nextPhaseFromResult('bugfix', 'CODE_FIX', result, { skipBugfixVerify: true }), 'REPORT');
  assert.equal(nextPhaseFromResult('bugfix', 'CODE_FIX', result, { skipBugfixVerify: false }), 'VERIFY');
});

void test('getTerminalPhases returns COMPLETED and BLOCKED for code-gen-tdd', () => {
  const t = getTerminalPhases('code-gen-tdd');
  assert.deepEqual(t.sort(), ['BLOCKED', 'COMPLETED']);
});

void test('Edges map: every workflow has an INITIALIZED node', () => {
  for (const wf of Object.keys(_edgesForTest) as Array<keyof typeof _edgesForTest>) {
    assert.ok(_edgesForTest[wf].INITIALIZED, `${wf} missing INITIALIZED`);
  }
});
