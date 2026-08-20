import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { ensureBugCase } from '../../src/runtime/bug-case.ts';

void test('ensureBugCase allocates a numbered directory and records the original description', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-bug-case-'));
  try {
    const result = ensureBugCase({ featureDir, bugDescription: '参数推断优先级错误' });
    assert.equal(result.bugCaseId, '1');
    assert.match(result.bugCaseDir, /^bugfix\/1-/);
    assert.ok(existsSync(join(featureDir, result.bugCaseDir, 'bug-report.md')));
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('ensureBugCase reuses an explicit numeric id and a single empty recovery directory', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-bug-case-'));
  try {
    const root = join(featureDir, 'bugfix');
    mkdirSync(join(root, '13-参数推断优先级调整为列元数据优先'), { recursive: true });
    const recovered = ensureBugCase({ featureDir, bugDescription: '参数推断优先级错误' });
    assert.equal(recovered.bugCaseId, '13');
    assert.equal(recovered.bugCaseDir, 'bugfix/13-参数推断优先级调整为列元数据优先');

    const explicit = ensureBugCase({ featureDir, bugDescription: '继续修复', bugCaseId: '13' });
    assert.equal(explicit.bugCaseDir, recovered.bugCaseDir);
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});
