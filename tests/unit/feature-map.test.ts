import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectFeatureTargets, validateFeatureMap } from '../../src/runtime/feature-map.ts';
import type { ServiceTarget } from '../../src/runtime/service-targets.ts';

void test('selectFeatureTargets limits a feature run to its mapped services', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-feature-map-'));
  const targets: ServiceTarget[] = [
    { service: 'orders', projectRoot: '/repos/orders', featureDir: '/repos/orders/req/feature' },
    { service: 'payment', projectRoot: '/repos/payment', featureDir: '/repos/payment/req/feature' },
    { service: 'catalog', projectRoot: '/repos/catalog', featureDir: '/repos/catalog/req/feature' },
  ];
  try {
    writeFileSync(join(featureDir, 'feature-map.json'), JSON.stringify({
      version: 1,
      features: [{ id: 'F-001', name: '创建订单', services: ['orders', 'payment'], acceptanceCriteria: ['AC-001'] }],
    }));

    const selection = selectFeatureTargets(featureDir, targets, 'F-001');

    assert.deepEqual(selection.targets.map((target) => target.service), ['orders', 'payment']);
    assert.deepEqual(selection.feature, {
      id: 'F-001', name: '创建订单', services: ['orders', 'payment'], acceptanceCriteria: ['AC-001'],
    });
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('validateFeatureMap rejects an unmapped service before code generation', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-feature-map-'));
  try {
    writeFileSync(join(featureDir, 'feature-map.json'), JSON.stringify({
      features: [{ id: 'F-001', name: '创建订单', primaryService: 'orders', services: ['orders', 'missing-service'] }],
    }));
    assert.throws(
      () => validateFeatureMap(featureDir, [{ service: 'orders', projectRoot: '/repos/orders', featureDir }]),
      /references services absent from apps.json: missing-service/
    );
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('validateFeatureMap requires primaryService to belong to services when provided', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-feature-map-'));
  try {
    writeFileSync(join(featureDir, 'feature-map.json'), JSON.stringify({
      features: [{ id: 'F-001', name: '创建订单', primaryService: 'payment', services: ['orders'] }],
    }));
    assert.throws(
      () => validateFeatureMap(featureDir, [{ service: 'orders', projectRoot: '/repos/orders', featureDir }]),
      /primaryService must be included in services/
    );
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('selectFeatureTargets rejects a requested feature that is not mapped', () => {
  const featureDir = mkdtempSync(join(tmpdir(), 'dsh-feature-map-'));
  try {
    writeFileSync(join(featureDir, 'feature-map.json'), JSON.stringify({
      features: [{ id: 'F-001', name: '创建订单', services: ['orders'] }],
    }));
    assert.throws(
      () => selectFeatureTargets(featureDir, [{ service: 'orders', projectRoot: '/repos/orders', featureDir }], 'F-404'),
      /Feature F-404 is not declared/
    );
  } finally {
    rmSync(featureDir, { recursive: true, force: true });
  }
});
