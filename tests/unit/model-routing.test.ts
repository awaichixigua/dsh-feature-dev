import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubagentExecutor, type SubagentInvokeArgs, type SubagentPort } from '../../src/executors/protocol.js';
import type { Agent } from '../../src/dsh/sdk.js';
import { makeDshSubagentPort } from '../../src/executors/spawn-port.js';
import type { DshContext } from '../../src/dsh/context.js';

void test('SubagentExecutor routes model from agent model_role', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-route-'));
  try {
    const promptPath = join(dir, 'planner.md');
    writeFileSync(promptPath, '---\nname: planner\nmodel_role: planning\n---\nPlan carefully.\n');
    let captured: SubagentInvokeArgs | undefined;
    const port: SubagentPort = {
      async invoke(args) {
        captured = args;
        return {
          rawText: '',
          result: { status: 'pass', summary: 'ok', artifacts: [], evidence: ['ok'], changedFiles: [] },
        };
      },
    };
    const executor = new SubagentExecutor(port, {
      provider: 'spawn',
      defaultModel: { provider: 'default-provider', model: 'default-model' },
      models: {
        planning: { provider: 'planning-provider', model: 'planning-model' },
        coding: { provider: 'coding-provider', model: 'coding-model' },
      },
      parent: {} as Agent,
    });

    await executor.run({
      runId: 'run',
      workflow: 'implementation-plan',
      phase: 'PRD',
      projectRoot: dir,
      promptPath,
      inputs: {},
      expectedArtifacts: [],
      mode: 'normal',
    });

    assert.deepEqual(captured?.agentOptions, {
      provider: 'planning-provider',
      model: 'planning-model',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('SubagentExecutor omits agentOptions so DSH inherits the parent model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-inherit-'));
  try {
    const promptPath = join(dir, 'reviewer.md');
    writeFileSync(promptPath, '---\nname: reviewer\nmodel_role: review\n---\nReview carefully.\n');
    let captured: SubagentInvokeArgs | undefined;
    const port: SubagentPort = {
      async invoke(args) {
        captured = args;
        return {
          rawText: '',
          result: { status: 'pass', summary: 'ok', artifacts: [], evidence: ['ok'], changedFiles: [] },
        };
      },
    };
    const executor = new SubagentExecutor(port, {
      provider: 'spawn',
      parent: {} as Agent,
    });

    await executor.run({
      runId: 'run',
      workflow: 'bugfix',
      phase: 'LOCATE',
      projectRoot: dir,
      promptPath,
      inputs: {},
      expectedArtifacts: [],
      mode: 'normal',
    });

    assert.equal(captured?.agentOptions, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('SubagentExecutor does not require optional metadata arrays in structured output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-output-schema-'));
  try {
    const promptPath = join(dir, 'reader.md');
    writeFileSync(promptPath, '---\nname: reader\nmodel_role: planning\n---\nRead carefully.\n');
    let captured: SubagentInvokeArgs | undefined;
    const port: SubagentPort = {
      async invoke(args) {
        captured = args;
        return { rawText: '', result: { status: 'warn', summary: '完成', artifacts: [], evidence: [], changedFiles: [] } };
      },
    };
    const executor = new SubagentExecutor(port, { provider: 'spawn', parent: {} as Agent });
    await executor.run({
      runId: 'run', workflow: 'implementation-plan', phase: 'MRD_READER', projectRoot: dir,
      promptPath, inputs: {}, expectedArtifacts: [], mode: 'normal',
    });

    const schema = captured?.outputSchema as { properties?: Record<string, unknown> } | undefined;
    assert.ok(schema?.properties?.status);
    assert.equal(schema?.properties?.evidence, undefined);
    assert.equal(schema?.properties?.changedFiles, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('SubagentExecutor places the Chinese language policy before agent instructions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-language-policy-'));
  try {
    const promptPath = join(dir, 'locator.md');
    writeFileSync(promptPath, '---\nname: locator\nmodel_role: review\n---\n只读定位问题。\n');
    let captured: SubagentInvokeArgs | undefined;
    const port: SubagentPort = {
      async invoke(args) {
        captured = args;
        return {
          rawText: '',
          result: { status: 'pass', summary: '定位完成', artifacts: [], evidence: ['已定位'], changedFiles: [] },
        };
      },
    };
    const executor = new SubagentExecutor(port, { provider: 'spawn', parent: {} as Agent });

    await executor.run({
      runId: 'run', workflow: 'bugfix', phase: 'LOCATE', projectRoot: dir,
      promptPath, inputs: {}, expectedArtifacts: [], mode: 'normal',
    });

    assert.equal(captured?.prompt[0]?.type, 'text');
    const firstBlock = captured?.prompt[0] as { type: 'text'; text: string } | undefined;
    assert.match(firstBlock?.text ?? '', /最高优先级：输出语言/);
    assert.match(firstBlock?.text ?? '', /工具调用前后的进度说明/);
    const instructionsBlock = captured?.prompt[1] as { type: 'text'; text: string } | undefined;
    assert.match(instructionsBlock?.text ?? '', /只读定位问题/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('SubagentExecutor injects rule paths for a packaged agent without inlining rule contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rule-policy-'));
  try {
    const promptPath = join(dir, 'agents', 'code-gen-tdd', 'code-impl.md');
    const serviceRoot = join(dir, 'services', 'orders');
    mkdirSync(join(dir, 'agents', 'code-gen-tdd'), { recursive: true });
    mkdirSync(join(dir, 'rules', 'common'), { recursive: true });
    mkdirSync(join(dir, 'rules', 'code-impl', 'project'), { recursive: true });
    mkdirSync(join(dir, 'arch-docs'), { recursive: true });
    mkdirSync(serviceRoot, { recursive: true });
    writeFileSync(promptPath, '---\nname: code-impl\nmodel_role: coding\n---\n实现代码。\n');
    writeFileSync(join(dir, 'rules', 'common', 'agents.md'), '# KB rules\n');
    writeFileSync(join(dir, 'rules', 'common', 'timing-spec.md'), '# Timing rules\n');
    writeFileSync(join(dir, 'rules', 'common', 'error-format.md'), '# Error rules\n');
    writeFileSync(join(dir, 'rules', 'code-impl', 'index.md'), '# Agent rules\n');
    writeFileSync(join(dir, 'rules', 'code-impl', 'project', 'conventions.md'), '# Java rules\n');
    writeFileSync(join(dir, 'arch-docs', 'project-tools-index.md'), '# Project tools\n');
    let captured: SubagentInvokeArgs | undefined;
    const port: SubagentPort = {
      async invoke(args) {
        captured = args;
        return {
          rawText: '',
          result: { status: 'pass', summary: '完成', artifacts: [], evidence: ['ok'], changedFiles: [] },
        };
      },
    };
    const executor = new SubagentExecutor(port, { provider: 'spawn', parent: {} as Agent });

    await executor.run({
      runId: 'run', workflow: 'code-gen-tdd', phase: 'PHASE2_IMPLEMENTATION', projectRoot: serviceRoot,
      promptPath,
      inputs: { kbContextPath: join(serviceRoot, 'app-knowledge-base', 'CONTEXT.md') },
      expectedArtifacts: [],
      mode: 'normal',
    });

    const ruleBlock = captured?.prompt[1] as { type: 'text'; text: string } | undefined;
    assert.match(ruleBlock?.text ?? '', /规则加载（必须执行）/);
    assert.match(ruleBlock?.text ?? '', /rules[\\/]common[\\/]agents\.md/);
    assert.match(ruleBlock?.text ?? '', /rules[\\/]common[\\/]timing-spec\.md/);
    assert.match(ruleBlock?.text ?? '', /rules[\\/]common[\\/]error-format\.md/);
    assert.match(ruleBlock?.text ?? '', /rules[\\/]code-impl[\\/]index\.md/);
    assert.match(ruleBlock?.text ?? '', /不得相对于 index 文件所在/);
    assert.match(ruleBlock?.text ?? '', /rules[\\/]library/);
    assert.doesNotMatch(ruleBlock?.text ?? '', /rules[\\/]code-impl[\\/]project[\\/]conventions\.md/);
    assert.doesNotMatch(ruleBlock?.text ?? '', /# Java rules/);
    const instructionsBlock = captured?.prompt[2] as { type: 'text'; text: string } | undefined;
    assert.match(instructionsBlock?.text ?? '', /实现代码/);
    const contextBlock = captured?.prompt[3] as { type: 'text'; text: string } | undefined;
    assert.match(contextBlock?.text ?? '', /项目级工具索引：[\s\S]*arch-docs[\\/]project-tools-index\.md/);
    assert.match(contextBlock?.text ?? '', /服务级 KB CONTEXT（必须使用此精确文件路径）/);
    assert.ok(
      (contextBlock?.text ?? '').includes(JSON.stringify(join(serviceRoot, 'app-knowledge-base', 'CONTEXT.md'))),
      '上下文应保留服务目录下的 kbContextPath'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('SubagentExecutor accepts valid text JSON when structured capture ends with error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-text-fallback-'));
  try {
    const promptPath = join(dir, 'locator.md');
    writeFileSync(promptPath, '---\nname: locator\nmodel_role: review\n---\nLocate only.\n');
    const textResult = JSON.stringify({
      status: 'pass',
      summary: 'located at Service.java:42',
      artifacts: [],
      evidence: ['file:Service.java:42'],
      changedFiles: [],
    });
    const dsh = {
      subagents: {
        start: async () => ({
          id: 'child',
          localAgent: undefined,
          result: Promise.resolve({
            stopReason: 'error',
            structured: null,
            output: [{ type: 'text', text: `\`\`\`json\n${textResult}\n\`\`\`` }],
          }),
          dispose: async () => {},
        }),
      },
    } as unknown as DshContext;
    const executor = new SubagentExecutor(makeDshSubagentPort(dsh), {
      provider: 'spawn',
      parent: {} as Agent,
    });

    const result = await executor.run({
      runId: 'run',
      workflow: 'bugfix',
      phase: 'LOCATE',
      projectRoot: dir,
      promptPath,
      inputs: {},
      expectedArtifacts: [],
      mode: 'normal',
    });

    assert.equal(result.status, 'warn');
    assert.match(result.summary, /文本已通过结构校验/);
    assert.ok(result.evidence.includes('subagent_stop_reason:error:text_fallback_accepted'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
