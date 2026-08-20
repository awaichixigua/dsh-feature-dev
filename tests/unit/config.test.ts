/**
 * Unit tests for config resolution.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULT_CONFIG } from '../../src/config.ts';

void test('resolveConfig: defaults are returned when undefined', () => {
  const c = resolveConfig(undefined);
  assert.equal(c.defaultWorkflow, DEFAULT_CONFIG.defaultWorkflow);
  assert.equal(c.maxRepairAttempts, DEFAULT_CONFIG.maxRepairAttempts);
  assert.equal(c.models, undefined);
});

void test('resolveConfig: applies overrides', () => {
  const c = resolveConfig({ maxRepairAttempts: 10, strictGates: false });
  assert.equal(c.maxRepairAttempts, 10);
  assert.equal(c.strictGates, false);
});

void test('resolveConfig: preserves only explicitly configured model routes', () => {
  const c = resolveConfig({
    models: { coding: { provider: 'p', model: 'm' } },
  });
  assert.deepEqual(c.models?.coding, { provider: 'p', model: 'm' });
  assert.equal(c.models?.planning, undefined);
});
