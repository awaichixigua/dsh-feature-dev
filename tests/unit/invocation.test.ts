/**
 * Unit tests for invocation normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvocation, parseSkillArgv, KNOWN_WORKFLOWS } from '../../src/runtime/invocation.ts';

void test('KNOWN_WORKFLOWS contains all required workflows', () => {
  for (const w of ['init', 'knowledge-base', 'implementation-plan', 'code-gen-tdd', 'bugfix', 'archive', 'code-question', 'prd-clarify', 'influence-menu', 'mrd-to-code']) {
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

void test('normalizeInvocation: requires mrdUrl for mrd-to-code', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'mrd-to-code' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'mrd-to-code' }
      ),
    /mrd-to-code requires mrdUrl/
  );
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

void test('normalizeInvocation: rejects Claude placeholders in args', () => {
  assert.throws(
    () =>
      normalizeInvocation(
        { workflow: 'init', projectRoot: 'C:\\foo\\$HOME\\.claude\\bar' },
        { importMetaUrl: import.meta.url, cwd: process.cwd(), defaultWorkflow: 'init' }
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

void test('parseSkillArgv: extracts a bugfix case id', () => {
  const r = parseSkillArgv('bugfix --feature-dir req/foo --bug-id 13 --bug 参数推断优先级错误');
  assert.equal(r.bugCaseId, '13');
});

void test('parseSkillArgv: empty input throws', () => {
  assert.throws(() => parseSkillArgv('   '), /Empty invocation/);
});
