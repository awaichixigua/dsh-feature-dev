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

void test('MRD clarification stays in the main conversation and resume goes directly to PRD', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-main-clarify-'));
  const serviceRepo = join(projectRoot, 'services', 'orders');
  const featureDir = join(serviceRepo, 'req', '1.0_1_order');
  const kbLocalPath = join(serviceRepo, 'app-knowledge-base');
  const labels: string[] = [];
  const port: SubagentPort = {
    async invoke(args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
      labels.push(args.label ?? '');
      writeFileSync(join(featureDir, 'prd.md'), `# PRD\n\n${'需求说明。'.repeat(60)}\n`, 'utf8');
      return {
        rawText: '',
        result: {
          status: 'pass',
          summary: 'PRD 已生成',
          artifacts: [join(featureDir, 'prd.md')],
          evidence: ['test:prd'],
          changedFiles: [join(featureDir, 'prd.md')],
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
    const inv = {
      workflow: 'implementation-plan' as const,
      projectRoot,
      featureDir,
      featureId: '1.0_1_order',
      options: { resume: false, unitTests: false, generateUnitTestsOnly: false, clarifyMode: 'dialogue' as const },
    };
    const deps = {
      ctx: { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      repo,
      created: false,
      executor,
      config: resolveConfig({}),
      spawnBudget: { used: 0, max: 12 },
    };

    const awaiting = await implementationPlan(state, inv, deps);

    assert.equal(awaiting.status, 'blocked');
    assert.deepEqual(labels, []);
    assert.equal(awaiting.agentCount, 0);
    assert.deepEqual(awaiting.pendingMainAction, {
      kind: 'clarify_mrd',
      mode: 'dialogue',
      mrdOriginalPath: join(featureDir, 'mrd-original.md'),
      mrdClarifiedPath: join(featureDir, 'mrd-clarified.md'),
      knowledgeBasePath: kbLocalPath,
      instruction: '由主会话读取 MRD 与可用知识库，向用户完成需求澄清并写入 mrd-clarified.md；写入后使用同一 projectRoot 和 featureDir 调用 feature_dev_resume。不要启动 mrd-clarify 子代理。',
    });

    writeFileSync(join(featureDir, 'mrd-clarified.md'), '# 澄清结论\n\n用户已确认范围。\n', 'utf8');
    rewindMostRecentFailure(awaiting);
    repo.writeAtomicPublic(awaiting);
    const resumed = await implementationPlan(awaiting, { ...inv, options: { ...inv.options, resume: true } }, deps);

    assert.equal(resumed.status, 'paused');
    assert.equal(resumed.pendingMainAction, undefined);
    assert.deepEqual(labels, ['workflow:implementation-plan | phase:prdGenerator']);
    assert.equal(resumed.agentCount, 1);
    assert.equal(resumed.pendingConfirmations[0]?.gate, 'pre_prd');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
