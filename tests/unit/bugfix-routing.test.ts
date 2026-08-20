import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunDocRevision } from '../../src/workflows/bugfix.ts';
import type { ExecutionState } from '../../src/types/contracts.ts';

function state(overrides: Partial<ExecutionState> = {}): ExecutionState {
  return {
    schemaVersion: '1.0.0', runId: 'run-1', workflow: 'bugfix', projectRoot: '/p',
    featureDir: '/p/req/f', currentPhase: 'LOCATE', phaseHistory: [],
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'running', repairCount: 0, agentCount: 0, pendingConfirmations: [], ...overrides,
  };
}

void test('code defect skips DOC_REVISION', () => {
  assert.equal(shouldRunDocRevision(state({ lastPhaseResult: {
    status: 'pass', summary: 'code bug', artifacts: [], evidence: ['file:x'], changedFiles: [],
    bugClassification: 'code_defect',
  } })), false);
});

void test('business requirement gap runs DOC_REVISION', () => {
  assert.equal(shouldRunDocRevision(state({ lastPhaseResult: {
    status: 'pass', summary: 'requirement gap', artifacts: [], evidence: ['prd:x'], changedFiles: [],
    bugClassification: 'business_requirement',
  } })), true);
});

void test('persisted business classification survives a cleared phase result', () => {
  assert.equal(shouldRunDocRevision(state({
    lastPhaseResult: undefined,
    bugClassification: 'business_requirement',
  })), true);
});
