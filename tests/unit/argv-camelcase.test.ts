/**
 * P1-4: parseToolArgv — CLI flags arrive kebab-case but tools expect
 * camelCase. Verify the conversion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolArgv } from '../../src/skills/provider.ts';

void test('--feature-dir → featureDir', () => {
  const r = parseToolArgv('--feature-dir req/create-order', 'code-gen-tdd');
  assert.equal(r.featureDir, 'req/create-order');
});

void test('--feature-dir=req/foo → featureDir', () => {
  const r = parseToolArgv('--feature-dir=req/foo', 'code-gen-tdd');
  assert.equal(r.featureDir, 'req/foo');
});

void test('--project-root / --mrd-url / --clarify-mode all convert', () => {
  const r = parseToolArgv('--project-root D:\\svc --mrd-url https://x/y --clarify-mode=batch', 'implementation-plan');
  assert.equal(r.projectRoot, 'D:\\svc');
  assert.equal(r.mrdUrl, 'https://x/y');
  assert.equal(r.clarifyMode, 'batch');
});

void test('--skip-unit-tests=false enables tests through the skill argument parser', () => {
  const r = parseToolArgv('--feature-dir req/create-order --skip-unit-tests=false', 'code-gen-tdd');
  assert.equal(r.options?.skipUnitTests, false);
});

void test('positional https URL becomes mrdUrl', () => {
  const r = parseToolArgv('https://example.com/share_doc/?token=abc', 'implementation-plan');
  assert.equal(r.workflow, 'implementation-plan');
  assert.equal(r.mrdUrl, 'https://example.com/share_doc/?token=abc');
});

void test('empty argv + defaultWorkflow seeds workflow', () => {
  const r = parseToolArgv('', 'code-gen-tdd');
  assert.equal(r.workflow, 'code-gen-tdd');
});

void test('explicit workflow wins over default', () => {
  const r = parseToolArgv('archive', 'code-gen-tdd');
  assert.equal(r.workflow, 'archive');
});
