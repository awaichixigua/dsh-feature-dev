import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveServiceTargets, selectRepairTargets } from '../../src/runtime/service-targets.ts';

void test('resolveServiceTargets returns primary and collaborators with service-local feature directories', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-service-targets-'));
  const featureDir = join(projectRoot, 'primary', 'req', '2.0.0_1_multi-service');
  try {
    mkdirSync(featureDir, { recursive: true });
    mkdirSync(join(projectRoot, 'payment'), { recursive: true });
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

void test('resolveServiceTargets rejects a repository that does not exist', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-service-targets-'));
  const featureDir = join(projectRoot, 'primary', 'req', '2.0.0_1_missing');
  try {
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
      primary: ['primary'],
      collaborators: ['missing'],
      repositories: { primary: 'primary', missing: 'missing' },
    }));

    assert.throws(
      () => resolveServiceTargets(projectRoot, featureDir),
      /repositories\.missing does not exist/
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

void test('resolveServiceTargets rejects repository paths outside projectRoot', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-service-targets-'));
  const featureDir = join(projectRoot, 'primary', 'req', '2.0.0_1_escape');
  try {
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
      primary: ['primary'],
      collaborators: ['outside'],
      repositories: { primary: 'primary', outside: '..\\outside-repository' },
    }));

    assert.throws(
      () => resolveServiceTargets(projectRoot, featureDir),
      /repositories\.outside is outside projectRoot/
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

void test('selectRepairTargets limits repair to failed or blocked services', () => {
  const targets = [
    { service: 'orders', projectRoot: '/repos/orders', featureDir: '/repos/orders/req/feature' },
    { service: 'payment', projectRoot: '/repos/payment', featureDir: '/repos/payment/req/feature' },
    { service: 'catalog', projectRoot: '/repos/catalog', featureDir: '/repos/catalog/req/feature' },
  ];
  assert.deepEqual(
    selectRepairTargets(targets, [
      'service_status:orders:pass',
      'service_status:payment:block',
      'service_status:catalog:failed',
    ]).map((target) => target.service),
    ['payment', 'catalog']
  );
});

void test('selectRepairTargets preserves all targets for legacy evidence', () => {
  const targets = [
    { service: 'orders', projectRoot: '/repos/orders', featureDir: '/repos/orders/req/feature' },
    { service: 'payment', projectRoot: '/repos/payment', featureDir: '/repos/payment/req/feature' },
  ];
  assert.equal(selectRepairTargets(targets, ['legacy:block']).length, 2);
});
