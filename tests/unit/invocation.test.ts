/**
 * Unit tests for invocation normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { normalizeInvocation, parseSkillArgv, KNOWN_WORKFLOWS } from '../../src/runtime/invocation.ts';

void test('KNOWN_WORKFLOWS contains all required workflows', () => {
  for (const w of ['knowledge-base', 'implementation-plan', 'code-gen-tdd', 'bugfix', 'archive', 'prd-clarify', 'influence-menu', 'mrd-to-code']) {
    assert.ok(KNOWN_WORKFLOWS.has(w as never), `missing ${w}`);
  }
});

void test('normalizeInvocation: rejects unknown workflow', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'bogus' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'code-gen-tdd' }
      ),
    /Unknown workflow/
  );
});

void test('normalizeInvocation: requires a source for mrd-to-code', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'mrd-to-code' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'mrd-to-code' }
      ),
    /mrd-to-code requires mrdUrl or rawUserRequest/
  );
});

void test('normalizeInvocation: mrd-to-code accepts direct requirement without mrdUrl', () => {
  const inv = normalizeInvocation(
    {
      workflow: 'mrd-to-code',
      projectRoot: process.cwd(),
      featureDir: process.cwd(),
      rawUserRequest: '支持按订单编号查询物流状态',
    },
    { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'mrd-to-code' }
  );
  assert.equal(inv.mrdUrl, undefined);
  assert.equal(inv.rawUserRequest, '支持按订单编号查询物流状态');
});

void test('normalizeInvocation: requires bugDescription for bugfix', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'bugfix' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'bugfix' }
      ),
    /bugfix requires bugDescription/
  );
});

void test('normalizeInvocation: bugfix skips tests unless explicitly requested', () => {
  const ctx = { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'bugfix' as const };
  const defaults = normalizeInvocation(
    { workflow: 'bugfix', bugDescription: 'SQL parser drops a parameter' },
    ctx
  );
  assert.equal(defaults.options.unitTests, false);
  const requested = normalizeInvocation(
    { workflow: 'bugfix', bugDescription: 'SQL parser drops a parameter', options: { unitTests: true } },
    ctx
  );
  assert.equal(requested.options.unitTests, true);
});

void test('normalizeInvocation: code-gen-tdd skips tests by default and enables them with skipUnitTests=false', () => {
  const ctx = { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'code-gen-tdd' as const };
  const defaults = normalizeInvocation({ workflow: 'code-gen-tdd', featureDir: process.cwd() }, ctx);
  assert.equal(defaults.options.unitTests, false);
  const requested = normalizeInvocation(
    { workflow: 'code-gen-tdd', featureDir: process.cwd(), options: { skipUnitTests: false } },
    ctx
  );
  assert.equal(requested.options.unitTests, true);
  const legacyRequest = normalizeInvocation(
    { workflow: 'code-gen-tdd', featureDir: process.cwd(), options: { unitTests: true } },
    ctx
  );
  assert.equal(legacyRequest.options.unitTests, false);
});

void test('normalizeInvocation: rejects Claude placeholders in args', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'influence-menu', projectRoot: 'C:\\foo\\$HOME\\.claude\\bar' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'influence-menu' }
      ),
    /Claude placeholder/
  );
});

void test('normalizeInvocation: rejects resume xor unit-tests-only', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        {
          workflow: 'code-gen-tdd',
          featureDir: process.cwd(),
          options: { resume: true, unitTests: false, generateUnitTestsOnly: true },
        },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'code-gen-tdd' }
      ),
    /mutually exclusive/
  );
});

void test('normalizeInvocation: resolves projectRoot and validates featureDir', () => {
  const inv = normalizeInvocation(
    {
      workflow: 'code-gen-tdd',
      projectRoot: process.cwd(),
      featureDir: process.cwd(),
      options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
    },
    { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'code-gen-tdd' }
  );
  assert.equal(inv.workflow, 'code-gen-tdd');
  assert.equal(inv.projectRoot, process.cwd());
  assert.equal(inv.featureDir, process.cwd());
});

void test('normalizeInvocation: defaults projectRoot to the current working directory', () => {
  const cwd = process.cwd();
  const inv = normalizeInvocation(
    {
      workflow: 'mrd-to-code',
      featureDir: '3.0.0_111111_热源描述',
      rawUserRequest: '增加热源描述字段',
    },
    { importMetaUrl: import.meta.url, cwd, defaultWorkflow: 'mrd-to-code' }
  );
  assert.equal(inv.projectRoot, cwd);
  assert.equal(inv.featureDir, resolve(cwd, '3.0.0_111111_热源描述'));
});

void test('parseSkillArgv: detects workflow from first positional', () => {
  const r = parseSkillArgv('code-gen-tdd --feature-dir req/foo');
  assert.equal(r.workflow, 'code-gen-tdd');
  assert.equal(r.featureDir, 'req/foo');
});

void test('parseSkillArgv: detects mrdUrl and defaults to implementation-plan', () => {
  const r = parseSkillArgv('https://example.com/share_doc/?token=abc');
  assert.equal(r.workflow, 'implementation-plan');
  assert.equal(r.mrdUrl, 'https://example.com/share_doc/?token=abc');
});

void test('parseSkillArgv: extracts clarify-mode', () => {
  const r = parseSkillArgv('implementation-plan https://example.com/x --clarify-mode=batch');
  assert.equal(r.options?.clarifyMode, 'batch');
});

void test('parseSkillArgv: accepts inline implementation-plan requirement', () => {
  const r = parseSkillArgv('implementation-plan "支持按订单编号查询物流状态" --feature-dir req/query-logistics');
  assert.equal(r.workflow, 'implementation-plan');
  assert.equal(r.mrdUrl, undefined);
  assert.equal(r.rawUserRequest, '支持按订单编号查询物流状态');
});

void test('parseSkillArgv: accepts inline mrd-to-code requirement', () => {
  const r = parseSkillArgv('mrd-to-code "支持按订单编号查询物流状态" --feature-dir req/query-logistics');
  assert.equal(r.workflow, 'mrd-to-code');
  assert.equal(r.mrdUrl, undefined);
  assert.equal(r.rawUserRequest, '支持按订单编号查询物流状态');
});

void test('normalizeInvocation: implementation-plan accepts direct requirement without mrdUrl', () => {
  const inv = normalizeInvocation(
    {
      workflow: 'implementation-plan',
      projectRoot: process.cwd(),
      featureDir: process.cwd(),
      rawUserRequest: '支持按订单编号查询物流状态',
    },
    { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'implementation-plan' }
  );
  assert.equal(inv.mrdUrl, undefined);
  assert.equal(inv.rawUserRequest, '支持按订单编号查询物流状态');
});

void test('parseSkillArgv: --skip-unit-tests=false enables unit tests', () => {
  const r = parseSkillArgv('code-gen-tdd --feature-dir req/foo --skip-unit-tests=false');
  assert.equal(r.options?.skipUnitTests, false);
});

void test('parseSkillArgv: --auto-comit enables automatic Git publishing', () => {
  const r = parseSkillArgv('code-gen-tdd --feature-dir req/foo --auto-comit');
  assert.equal(r.options?.autoCommit, true);
  const normalized = normalizeInvocation(
    { workflow: 'code-gen-tdd', featureDir: process.cwd(), options: r.options },
    { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'code-gen-tdd' }
  );
  assert.equal(normalized.options.autoCommit, true);
});

void test('parseSkillArgv: --auto-commit is accepted as an alias', () => {
  const r = parseSkillArgv('bugfix --feature-dir req/foo --bug parser fails --auto-commit');
  assert.equal(r.options?.autoCommit, true);
});

void test('normalizeInvocation: rejects auto commit for unsupported workflows', () => {
  assert.throws(
    () => normalizeInvocation(
      { workflow: 'archive', options: { autoCommit: true } },
      { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'archive' }
    ),
    /auto-comit is supported only/
  );
});

void test('parseSkillArgv: extracts a bugfix case id', () => {
  const r = parseSkillArgv('bugfix --feature-dir req/foo --bug-id 13 --bug 参数推断优先级错误');
  assert.equal(r.bugCaseId, '13');
});

void test('parseSkillArgv: empty input throws', () => {
  assert.throws(() => parseSkillArgv('   '), /Empty invocation/);
});
