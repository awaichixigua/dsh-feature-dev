import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SubagentExecutor, type SubagentPort } from '../../src/executors/protocol.js';
import { resolveConfig } from '../../src/config.js';
import { StateRepository } from '../../src/runtime/state-repository.js';
import { confirmFeatureDev } from '../../src/tools/confirm.js';
import { implementationPlan } from '../../src/workflows/implementation-plan.js';
import type { PhaseResult } from '../../src/types/contracts.js';
import type { Agent } from '../../src/dsh/sdk.js';

const here = fileURLToPath(import.meta.url);
const packageRoot = resolve(here, '..', '..', '..');

void test('service routing pauses for scope confirmation before branch preparation', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-service-scope-gate-'));
  const featureDir = join(projectRoot, 'req', '1.0_1_order');
  const port: SubagentPort = {
    async invoke(): Promise<{ rawText: string; result?: PhaseResult }> {
      return {
        rawText: '',
        result: {
          status: 'pass', summary: 'service routing completed', artifacts: [],
          evidence: ['test:service-routing'], changedFiles: [],
        },
      };
    },
  };

  try {
    mkdirSync(join(featureDir, 'ai'), { recursive: true });
    writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
      primary: ['orders'], collaborators: ['billing'], readOnly: ['catalog'],
      repositories: { orders: 'services/orders', billing: 'services/billing' },
    }), 'utf8');
    const repo = new StateRepository({ projectRoot, featureDir });
    const state = repo.create({ workflow: 'implementation-plan', projectRoot, featureDir });
    state.currentPhase = 'MRD_READER';
    state.phaseHistory.push({ phase: 'MRD_READER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt });
    repo.writeAtomicPublic(state);
    const executor = new SubagentExecutor(port, {
      provider: 'spawn', defaultModel: { provider: 'test', model: 'test' }, parent: {} as Agent,
    });

    await implementationPlan(state, {
      workflow: 'implementation-plan', projectRoot, featureDir, featureId: '1.0_1_order',
      options: { resume: false, unitTests: false, generateUnitTestsOnly: false },
    }, {
      ctx: { packageRoot, importMetaUrl: import.meta.url }, repo, created: false, executor,
      config: resolveConfig({}), spawnBudget: { used: 0, max: 12 },
    });

    const paused = repo.read();
    assert.equal(paused.status, 'paused');
    assert.equal(paused.currentPhase, 'SERVICE_ROUTER');
    assert.equal(paused.pendingConfirmations.length, 1);
    assert.equal(paused.pendingConfirmations[0]!.gate, 'post_service_router');
    assert.equal(paused.phaseHistory.some((entry) => entry.phase === 'BRANCH_GATE'), false);

    const confirmed = await confirmFeatureDev(
      { packageRoot, importMetaUrl: import.meta.url },
      { projectRoot, featureDir, gate: 'post_service_router', choice: 'revise' }
    );
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    if (!confirmed.ok) return;
    assert.equal(confirmed.data.action, 'rewind');
    assert.equal(repo.read().currentPhase, 'MRD_READER');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
