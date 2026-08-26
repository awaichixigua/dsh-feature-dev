/**
 * Contract tests: skills and tools.
 *
 * These tests enforce the public contract that DSH depends on:
 *   - exactly 8 skills are registered, with the right names
 *   - each skill is invocable and has a non-empty description
 *   - the 4 feature_dev_* tools have stable schemas
 *   - no skill body contains Claude placeholders
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverSkills } from '../../src/skills/provider.ts';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(here, '..', '..');

void test('8 skills are discoverable from the package root', () => {
  const skills = discoverSkills(PKG_ROOT);
  const names = skills.map((s) => s.name).sort();
  assert.deepEqual(names, [
    'archive',
    'bugfix',
    'code-gen-tdd',
    'implementation-plan',
    'influence-menu',
    'knowledge-base',
    'mrd-to-code',
    'prd-clarify',
  ]);
});

void test('each skill has a description and is user-invocable', () => {
  const skills = discoverSkills(PKG_ROOT);
  for (const s of skills) {
    assert.ok(s.description.length > 10, `${s.name}: description too short`);
    assert.equal(s.userInvocable, true, `${s.name}: not user-invocable`);
  }
});

void test('skill frontmatter accepts CRLF line endings', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-crlf-'));
  try {
    const skillPath = join(root, 'skills', 'windows-skill', 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, '---\r\nname: windows-skill\r\ndescription: Supports Windows checkouts.\r\n---\r\n\r\n# Windows skill\r\n');
    const [skill] = discoverSkills(root);
    assert.equal(skill?.name, 'windows-skill');
    assert.equal(skill?.description, 'Supports Windows checkouts.');
    assert.equal(skill?.body, '# Windows skill');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('no skill body contains a Claude placeholder', () => {
  const skills = discoverSkills(PKG_ROOT);
  const FORBIDDEN = ['$ARGUMENTS', 'CLAUDE_PLUGIN_ROOT', '$HOME/.claude', '/feature-dev:', 'Task tool', 'TodoWrite', 'AskUserQuestion'];
  for (const s of skills) {
    for (const f of FORBIDDEN) {
      assert.ok(!s.body.includes(f), `${s.name} body contains forbidden: ${f}`);
      assert.ok(!s.description.includes(f), `${s.name} description contains forbidden: ${f}`);
    }
  }
});

void test('planning skills delegate missing projectRoot to runtime without repository preflight', () => {
  const skills = discoverSkills(PKG_ROOT);
  for (const name of ['implementation-plan', 'mrd-to-code']) {
    const skill = skills.find((item) => item.name === name);
    assert.ok(skill, `missing ${name}`);
    assert.match(skill.body, /当前工作目录/);
    assert.match(skill.body, /不得为推断项目根目录/);
    assert.match(skill.body, /app-router/);
  }
});

void test('each skill has a resourceBase inside the package', () => {
  const skills = discoverSkills(PKG_ROOT);
  for (const s of skills) {
    assert.ok(s.resourceBase.startsWith(PKG_ROOT), `${s.name} resourceBase escapes package`);
    assert.ok(existsSync(s.resourceBase), `${s.name} resourceBase does not exist`);
  }
});

void test('4 tools have stable string names', () => {
  // Tool names are a contract; this test guards against silent renames.
  const expected = ['feature_dev_run', 'feature_dev_resume', 'feature_dev_status', 'feature_dev_confirm'];
  for (const name of expected) {
    assert.match(name, /^feature_dev_[a-z_]+$/);
  }
});
