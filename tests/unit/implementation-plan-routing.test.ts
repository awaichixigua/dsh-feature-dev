import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SubagentExecutor, type SubagentInvokeArgs, type SubagentPort } from '../../src/executors/protocol.js';
import { resolveConfig } from '../../src/config.js';
import { StateRepository } from '../../src/runtime/state-repository.js';
import { implementationPlan } from '../../src/workflows/implementation-plan.js';
import type { PhaseResult } from '../../src/types/contracts.js';
import type { Agent } from '../../src/dsh/sdk.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

void test('mrd-clarify receives the primary service repository knowledge base after routing', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-clarify-routing-'));
  const serviceRepo = join(projectRoot, 'services', 'orders');
  const featureDir = join(serviceRepo, 'req', '1.0_1_order');
  const kbLocalPath = join(serviceRepo, 'app-knowledge-base');
  let clarifyPrompt = '';
  const port: SubagentPort = {
    async invoke(args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
      clarifyPrompt = args.prompt
        .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
        .join('\n');
      return {
        rawText: '',
        result: {
          status: 'block',
          summary: '验证澄清输入后停止',
          artifacts: [],
          evidence: ['test:clarify-inputs'],
          changedFiles: [],
          blocker: '测试终止',
        },
      };
    },
  };

  try {
    mkdirSync(join(featureDir, 'ai'), { recursive: true });
    mkdirSync(kbLocalPath, { recursive: true });
    writeFileSync(join(featureDir, 'mrd-original.md'), '# MRD\n', 'utf8');
    writeFileSync(join(kbLocalPath, 'CONTEXT.md'), '# Context\n', 'utf8');

    const repo = new StateRepository({ projectRoot, featureDir });
    const state = repo.create({ workflow: 'implementation-plan', projectRoot, featureDir });
    state.currentPhase = 'BRANCH_GATE';
    state.phaseHistory.push(
      { phase: 'MRD_READER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt },
      { phase: 'SERVICE_ROUTER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt },
      { phase: 'BRANCH_GATE', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt },
    );
    repo.writeAtomicPublic(state);

    const executor = new SubagentExecutor(port, {
      provider: 'spawn',
      defaultModel: { provider: 'test', model: 'test' },
      parent: {} as Agent,
    });
    await implementationPlan(state, {
      workflow: 'implementation-plan',
      projectRoot,
      featureDir,
      featureId: '1.0_1_order',
      options: { resume: false, unitTests: false, generateUnitTestsOnly: false },
    }, {
      ctx: { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      repo,
      created: false,
      executor,
      config: resolveConfig({}),
      spawnBudget: { used: 0, max: 12 },
    });

    assert.ok(clarifyPrompt.includes(JSON.stringify(join(featureDir, 'mrd-original.md'))));
    assert.ok(clarifyPrompt.includes('"kb_local_path"'));
    assert.ok(clarifyPrompt.includes(JSON.stringify(kbLocalPath)));
    assert.ok(clarifyPrompt.includes(JSON.stringify(join(kbLocalPath, 'CONTEXT.md'))));
    assert.ok(clarifyPrompt.includes(`需求目录：${featureDir}`));
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
