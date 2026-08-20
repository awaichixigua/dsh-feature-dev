/**
 * Identity collision tests for the metrics state file.
 *
 * Verifies the rule "code_gen and bugfix for the same feature never
 * share a state file" — a regression would mean a pending code_gen
 * run gets mistaken for a resumed bugfix run (or vice versa) and
 * the queue envelope for the wrong run gets delivered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateIdentity } from '../../src/metrics/state.ts';

const scope = { type: 'feature' as const, target_feature_id: 'F-12' };
const projectRoot = '/p';
const featureDir = '/p/req/foo';

void test('code_gen and bugfix for the same feature hash differently', () => {
  const code = stateIdentity(projectRoot, featureDir, scope, 'code_gen');
  const bug = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '42');
  assert.notEqual(code, bug);
});

void test('two bugfix runs with different bug ids hash differently', () => {
  const a = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '1');
  const b = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '2');
  assert.notEqual(a, b);
});

void test('two bugfix runs with the same bug id but different binding ids hash differently', () => {
  const a = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '1', 'binding-A');
  const b = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '1', 'binding-B');
  assert.notEqual(a, b);
});

void test('code_gen defaults hash is stable across calls (idempotent)', () => {
  const a = stateIdentity(projectRoot, featureDir, scope, 'code_gen');
  const b = stateIdentity(projectRoot, featureDir, scope, 'code_gen');
  assert.equal(a, b);
});

void test('bugfix identity is stable for the same (bugId, bindingId) pair', () => {
  const a = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '7', 'binding-X');
  const b = stateIdentity(projectRoot, featureDir, scope, 'bugfix', '7', 'binding-X');
  assert.equal(a, b);
});

void test('scope (target_feature_id) participates in the identity', () => {
  const a = stateIdentity(projectRoot, featureDir, { type: 'feature', target_feature_id: 'F-1' }, 'code_gen');
  const b = stateIdentity(projectRoot, featureDir, { type: 'feature', target_feature_id: 'F-2' }, 'code_gen');
  assert.notEqual(a, b);
});
