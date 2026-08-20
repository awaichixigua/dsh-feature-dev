/**
 * P1-4: invocation accepts relative featureDir and resolves it against
 * projectRoot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeInvocation } from '../../src/runtime/invocation.ts';

void test('relative featureDir is resolved against projectRoot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rel-'));
  try {
    mkdirSync(join(dir, '.git'), { recursive: true });
    mkdirSync(join(dir, 'req', 'foo'), { recursive: true });
    const inv = normalizeInvocation(
      {
        workflow: 'code-gen-tdd',
        projectRoot: dir,
        featureDir: 'req/foo',
        options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
      },
      { importMetaUrl: import.meta.url }
    );
    assert.ok(inv.featureDir);
    // Resolved to absolute, inside projectRoot
    assert.ok(inv.featureDir!.startsWith(dir));
    assert.ok(inv.featureDir!.endsWith('req\\foo') || inv.featureDir!.endsWith('req/foo'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('absolute featureDir is preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rel-'));
  try {
    mkdirSync(join(dir, '.git'), { recursive: true });
    mkdirSync(join(dir, 'req', 'bar'), { recursive: true });
    const inv = normalizeInvocation(
      {
        workflow: 'code-gen-tdd',
        projectRoot: dir,
        featureDir: join(dir, 'req', 'bar'),
        options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
      },
      { importMetaUrl: import.meta.url }
    );
    assert.ok(inv.featureDir);
    assert.ok(inv.featureDir!.endsWith('req\\bar') || inv.featureDir!.endsWith('req/bar'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
