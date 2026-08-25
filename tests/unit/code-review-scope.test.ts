import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeGenTdd, resolveReviewScope } from '../../src/workflows/code-gen-tdd.js';
import { StateRepository } from '../../src/runtime/state-repository.js';
import { SubagentExecutor, type SubagentInvokeArgs, type SubagentPort } from '../../src/executors/protocol.js';
import { resolveConfig } from '../../src/config.js';
import type { Agent } from '../../src/dsh/sdk.js';
import type { PhaseResult } from '../../src/types/contracts.js';

const here = fileURLToPath(import.meta.url);
const packageRoot = resolve(here, '..', '..', '..');

void test('review scope uses only previous-phase files inside the current service', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-review-scope-'));
  try {
    const scope = resolveReviewScope([
      'src/Changed.java',
      join(projectRoot, 'src', 'Other.java'),
      '../outside.java',
      'src/Changed.java',
    ], projectRoot);

    assert.equal(scope.source, 'previous-phase');
    assert.equal(scope.lineMode, 'added-lines-only');
    assert.deepEqual(scope.changedFiles, [
      resolve(projectRoot, 'src', 'Changed.java'),
      resolve(projectRoot, 'src', 'Other.java'),
    ]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

void test('PHASE3_REVIEW receives files actually changed by PHASE2 even when the child omits changedFiles', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-review-request-'));
  const featureDir = join(projectRoot, 'req', 'review-request');
  const changedFile = join(projectRoot, 'src', 'Changed.java');
  const calls: SubagentInvokeArgs[] = [];
  const port: SubagentPort = {
    async invoke(args): Promise<{ rawText: string; result?: PhaseResult }> {
      calls.push(args);
      if (args.label?.includes('PHASE2_IMPLEMENTATION')) {
        writeFileSync(changedFile, 'class Changed { int value = 1; }\n', 'utf8');
      }
      return {
        rawText: '',
        result: { status: 'pass', summary: '阶段完成', artifacts: [], evidence: ['test:pass'], changedFiles: [] },
      };
    },
  };

  try {
    mkdirSync(join(featureDir, 'ai'), { recursive: true });
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(changedFile, 'class Changed {}\n', 'utf8');
    writeFileSync(join(featureDir, 'tech-design.md'), '# Tech design\n', 'utf8');
    writeFileSync(join(featureDir, 'ai', 'test_spec.md'), '# Test spec\n', 'utf8');
    writeFileSync(join(featureDir, 'ai', 'code-review.md'), '# Code review\n\n' + 'x'.repeat(160), 'utf8');

    const repo = new StateRepository({ projectRoot, featureDir });
    const state = repo.create({ workflow: 'code-gen-tdd', projectRoot, featureDir });
    state.currentPhase = 'PHASE2_IMPLEMENTATION';
    repo.writeAtomicPublic(state);
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: projectRoot, stdio: 'ignore' });

    const executor = new SubagentExecutor(port, {
      provider: 'spawn',
      defaultModel: { provider: 'test', model: 'test' },
      parent: {} as Agent,
    });
    await codeGenTdd(state, {
      workflow: 'code-gen-tdd',
      projectRoot,
      featureDir,
      options: { resume: true, unitTests: false, generateUnitTestsOnly: false },
    }, {
      ctx: { packageRoot, importMetaUrl: import.meta.url },
      repo,
      created: false,
      executor,
      config: resolveConfig({}),
      spawnBudget: { used: 0, max: 12 },
    });

    const reviewCall = calls.find((call) => call.label?.includes('PHASE3_REVIEW'));
    assert.ok(reviewCall, 'code-review subagent was not invoked');
    const context = reviewCall.prompt
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .find((text) => text.includes('"reviewScope"')) ?? '';
    assert.match(context, /"source": "previous-phase"/);
    assert.ok(context.includes(JSON.stringify(resolve(changedFile))), 'review scope must include the changed file');
    assert.doesNotMatch(context, /execution-state\.json/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

void test('packaged code-review instructions prohibit repository-wide review', () => {
  const prompt = readFileSync(resolve(packageRoot, 'agents', 'code-gen-tdd', 'code-review.md'), 'utf8');
  const rules = readFileSync(resolve(packageRoot, 'rules', 'code-review', 'index.md'), 'utf8');

  assert.match(prompt, /reviewScope\.changedFiles/);
  assert.match(prompt, /不得执行不带路径限制的 `git diff`、全仓搜索、全模块扫描/);
  assert.match(prompt, /不得默认读取整个文件/);
  assert.match(prompt, /每一条问题必须包含清单内文件路径和本次 diff 的新增行号/);
  assert.match(rules, /唯一允许审查的文件清单/);
});
