/**
 * Unit tests for the PhaseResult parser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhaseResult } from '../../src/executors/protocol.ts';

void test('parses fenced JSON block', () => {
  const raw = 'thinking... ok.\n```json\n{"status":"pass","summary":"ok","artifacts":[],"evidence":["x"],"changedFiles":[]}\n```';
  const r = parsePhaseResult(raw, []);
  assert.equal(r.status, 'pass');
  assert.deepEqual(r.evidence, ['x']);
});

void test('downgrades pass with no evidence to warn', () => {
  const raw = '{"status":"pass","summary":"ok","artifacts":[],"evidence":[],"changedFiles":[]}';
  const r = parsePhaseResult(raw, []);
  assert.equal(r.status, 'warn');
  assert.ok(r.evidence.some((e) => e.includes('auto_evidence')));
});

void test('normalizes missing changedFiles and non-string evidence from a child response', () => {
  const raw = JSON.stringify({
    status: 'pass',
    summary: '已修复',
    artifacts: [],
    evidence: ['file:src/Service.java:12', { item: ['src/Service.java'] }],
  });
  const r = parsePhaseResult(raw, []);
  assert.deepEqual(r.changedFiles, []);
  assert.equal(r.evidence[1], '{"item":["src/Service.java"]}');
});

void test('invalid status returns failed', () => {
  const raw = '{"status":"bogus","summary":"x","artifacts":[],"evidence":[],"changedFiles":[]}';
  const r = parsePhaseResult(raw, []);
  assert.equal(r.status, 'failed');
  assert.equal(r.evidence[0], 'schema_violation:status');
});

void test('invalid JSON returns failed', () => {
  const r = parsePhaseResult('not json', []);
  assert.equal(r.status, 'failed');
  assert.ok(r.evidence[0]!.startsWith('json_error'));
});

void test('block without blocker is annotated', () => {
  const raw = '{"status":"block","summary":"x","artifacts":[],"evidence":[],"changedFiles":[]}';
  const r = parsePhaseResult(raw, []);
  assert.equal(r.status, 'block');
  assert.match(r.summary, /未提供解除条件/);
});

void test('preserves a valid bugfix LOCATE classification', () => {
  const raw = '{"status":"pass","summary":"existing code violates the API contract","artifacts":[],"evidence":["file:src/Service.java:42"],"changedFiles":[],"bugClassification":"code_defect"}';
  const r = parsePhaseResult(raw, []);
  assert.equal(r.bugClassification, 'code_defect');
});
