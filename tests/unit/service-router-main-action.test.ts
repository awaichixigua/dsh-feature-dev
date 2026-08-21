import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SubagentExecutor, type SubagentInvokeArgs, type SubagentPort } from '../../src/executors/protocol.js';
import { resolveConfig } from '../../src/config.js';
import { rewindMostRecentFailure, StateRepository } from '../../src/runtime/state-repository.js';
import { implementationPlan } from '../../src/workflows/implementation-plan.js';
import type { PhaseResult } from '../../src/types/contracts.js';
import type { Agent } from '../../src/dsh/sdk.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

void test('an unresolved app-router result becomes a main-conversation service confirmation', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-route-main-action-'));
  const featureDir = join(projectRoot, '.tmp', 'mrdoc-test');
  const labels: string[] = [];
  const port: SubagentPort = {
    async invoke(args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
      labels.push(args.label ?? '');
      writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
        primary: [], collaborators: [], readOnly: [], uncertain: ['engi-common'],
      }, null, 2), 'utf8');
      return {
        rawText: '',
        result: {
          status: 'block',
          summary: '无法确认服务范围',
          artifacts: [join(featureDir, 'apps.json')],
          evidence: ['route:uncertain'],
          changedFiles: [join(featureDir, 'apps.json')],
          blocker: '需要用户确认服务范围',
        },
      };
    },
  };

  try {
    mkdirSync(join(featureDir, 'ai'), { recursive: true });
    mkdirSync(join(projectRoot, 'services', 'engi-common', '.git'), { recursive: true });
    writeFileSync(join(featureDir, 'mrd-original.md'), '# MRD\n\n基础库替换\n', 'utf8');
    const repo = new StateRepository({ projectRoot, featureDir });
    const state = repo.create({ workflow: 'implementation-plan', projectRoot, featureDir, featureId: '2.0.0_103111_fastjson替换为jackson' });
    state.currentPhase = 'MRD_READER';
    state.phaseHistory.push({ phase: 'MRD_READER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt });
    repo.writeAtomicPublic(state);
    const executor = new SubagentExecutor(port, {
      provider: 'spawn', defaultModel: { provider: 'test', model: 'test' }, parent: {} as Agent,
    });
    const inv = {
      workflow: 'implementation-plan' as const,
      projectRoot,
      featureDir,
      featureId: state.featureId,
      options: { resume: false, unitTests: false, generateUnitTestsOnly: false, clarifyMode: 'dialogue' as const },
    };
    const deps = { ctx: { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url }, repo, created: false, executor, config: resolveConfig({}), spawnBudget: { used: 0, max: 12 } };

    const blocked = await implementationPlan(state, inv, deps);
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(labels, ['workflow:implementation-plan | phase:appRouter']);
    assert.equal(blocked.pendingConfirmations.length, 0);
    assert.equal(blocked.pendingMainAction?.kind, 'route_services');
    if (blocked.pendingMainAction?.kind !== 'route_services') return;
    assert.equal(blocked.pendingMainAction.appsPath, join(featureDir, 'apps.json'));
    assert.match(blocked.lastPhaseResult?.blocker ?? '', /主会话/);

    // Simulate the main-session answer. Resume must use this authoritative
    // file and must not spin up app-router a second time.
    writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
      primary: ['engi-common'], collaborators: [], readOnly: [],
      repositories: { 'engi-common': 'services/engi-common' },
    }, null, 2), 'utf8');
    rewindMostRecentFailure(blocked);
    repo.writeAtomicPublic(blocked);
    const resumed = await implementationPlan(blocked, { ...inv, options: { ...inv.options, resume: true } }, deps);

    assert.deepEqual(labels, ['workflow:implementation-plan | phase:appRouter']);
    assert.equal(resumed.pendingMainAction, undefined);
    assert.equal(resumed.pendingConfirmations.length, 0);
    assert.equal(resumed.phaseHistory.at(-1)?.phase, 'BRANCH_GATE');
    assert.equal(resumed.phaseHistory.at(-1)?.status, 'block');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
