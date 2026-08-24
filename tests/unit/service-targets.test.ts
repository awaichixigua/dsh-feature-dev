import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveServiceTargets } from '../../src/runtime/service-targets.ts';

void test('resolveServiceTargets returns primary and collaborators with service-local feature directories', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-service-targets-'));
  const featureDir = join(projectRoot, 'primary', 'req', '2.0.0_1_multi-service');
  try {
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
      primary: ['primary'],
      collaborators: ['payment'],
      repositories: { primary: 'primary', payment: 'payment' },
    }));

    const targets = resolveServiceTargets(projectRoot, featureDir);

    assert.deepEqual(targets, [
      { service: 'primary', projectRoot: join(projectRoot, 'primary'), featureDir },
      { service: 'payment', projectRoot: join(projectRoot, 'payment'), featureDir: join(projectRoot, 'payment', 'req', '2.0.0_1_multi-service') },
    ]);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
