import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bugfix } from '../../src/workflows/bugfix.ts';
import { StateRepository } from '../../src/runtime/state-repository.ts';
import { SubagentExecutor, type SubagentInvokeArgs, type SubagentPort } from '../../src/executors/protocol.ts';
import { resolveConfig } from '../../src/config.ts';
import type { Agent } from '../../src/dsh/sdk.ts';
import type { FeatureDevInvocation, PhaseResult } from '../../src/types/contracts.ts';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

void test('code-defect bugfix skips prd-generator, influence-menu, and tests by default', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-bugfix-branch-'));
  const featureDir = join(projectRoot, 'req', 'case');
  const labels: string[] = [];
  const port: SubagentPort = {
    async invoke(args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
      labels.push(args.label);
      return {
        rawText: '',
        result: { status: 'pass', summary: `${args.label} complete`, artifacts: [], evidence: ['stub:pass'], changedFiles: [] },
      };
    },
  };
  try {
    const bugCaseDir = 'bugfix/13-参数推断被样例值覆盖列元数据';
    mkdirSync(join(featureDir, bugCaseDir), { recursive: true });
    // REPORT is the only bugfix phase with a required artifact.
    writeFileSync(join(featureDir, bugCaseDir, 'bugfix-report.md'), '# Report\n\n' + 'x'.repeat(120));
    const repo = new StateRepository({ projectRoot, featureDir });
    const state = repo.create({ workflow: 'bugfix', projectRoot, featureDir, bugDescription: 'SQL parameter inference is incorrect' });
    state.currentPhase = 'LOCATE';
    state.bugClassification = 'code_defect';
    state.bugCaseDir = bugCaseDir;
    state.lastPhaseResult = {
      status: 'pass', summary: 'parser branch drops description values', artifacts: [],
      evidence: ['file:src/SqlParser.java:42'], changedFiles: [], bugClassification: 'code_defect',
    };
    state.phaseHistory.push({ phase: 'LOCATE', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: state.lastPhaseResult.summary });
    repo.writeAtomicPublic(state);
    const executor = new SubagentExecutor(port, { provider: 'spawn', parent: {} as Agent });
    const inv: FeatureDevInvocation = {
      workflow: 'bugfix', projectRoot, featureDir, bugDescription: state.bugDescription,
      options: { resume: true, unitTests: true, generateUnitTestsOnly: false },
    };
    const result = await bugfix(state, inv, {
      ctx: { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url }, repo, created: false,
      executor, config: resolveConfig({}), spawnBudget: { used: 0, max: 10 },
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(labels, [
      'workflow:bugfix | phase:bugfix-fix',
      'workflow:bugfix | phase:bugfix-report',
    ]);
    assert.ok(!labels.some((label) => label.includes('influence-menu')));
    assert.ok(!labels.some((label) => label.includes('prd-generator')));
    assert.ok(!labels.some((label) => label.includes('tdd-test-runner')));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
