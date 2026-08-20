/**
 * Contract tests for the npm package contents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');

void test('package.json: name, version, dsh.bundle.patch are set', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    type: string;
    dsh?: { bundle?: { patch?: string } };
    files: string[];
  };
  assert.match(pkg.name, /^@[\w-]+\/dsh-feature-dev$/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  for (const required of ['lib', 'cordis.patch.yml', 'skills', 'agents', 'rules', 'templates', 'scripts', 'schemas']) {
    assert.ok(pkg.files.includes(required), `files[] missing ${required}`);
  }
});

void test('cordis.patch.yml: declares the bundle with sane config', () => {
  const yml = readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(yml, /dsh-feature-dev/);
  assert.match(yml, /defaultWorkflow: code-gen-tdd/);
  assert.match(yml, /strictGates: true/);
  assert.match(yml, /maxTotalAgents: \d+/);
  assert.match(yml, /maxRepairAttempts: \d+/);
});

void test('JSON Schemas: 3 schemas are present and parse', () => {
  for (const f of ['invocation.schema.json', 'phase-result.schema.json', 'execution-state.schema.json']) {
    const p = resolve(ROOT, 'schemas', f);
    assert.ok(existsSync(p), `${f} missing`);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as { title?: string; type?: string };
    assert.equal(parsed.type, 'object');
    assert.ok(parsed.title);
  }
});

void test('All 9 SKILL.md files exist', () => {
  const expected = [
    'mrd-to-code',
    'init',
    'knowledge-base',
    'implementation-plan',
    'code-gen-tdd',
    'bugfix',
    'archive',
    'code-question',
    'prd-clarify',
    'influence-menu',
  ];
  for (const name of expected) {
    const p = resolve(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(p), `${name}/SKILL.md missing`);
  }
});

void test('Agent rule indexes point to packaged on-demand rule topics', () => {
  const indexes = ['code-impl', 'code-review', 'bugfix-fix', 'tdd-test-spec', 'testcode-gen', 'tdd-test-runner'];
  for (const agent of indexes) {
    const indexPath = resolve(ROOT, 'rules', agent, 'index.md');
    assert.ok(existsSync(indexPath), `${agent}/index.md missing`);
    const content = readFileSync(indexPath, 'utf8');
    const references = [...content.matchAll(/`(library\/[\w/-]+\.md)`/g)];
    assert.ok(references.length > 0, `${agent}/index.md has no library references`);
    for (const match of references) {
      assert.ok(existsSync(resolve(ROOT, 'rules', match[1]!)), `${agent}/index.md references a missing rule: ${match[1]}`);
    }
  }
});
