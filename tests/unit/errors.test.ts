/**
 * Unit tests for error types.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FeatureDevError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  StateMachineError,
  GateError,
  ExecutorError,
  isFeatureDevError,
  toErrorPayload,
} from '../../src/runtime/errors.ts';

void test('Each error has a stable code', () => {
  const samples = [
    [new ValidationError('x'), 'E_VALIDATION'],
    [new NotFoundError('x'), 'E_NOT_FOUND'],
    [new ForbiddenError('x'), 'E_FORBIDDEN'],
    [new ConflictError('x'), 'E_CONFLICT'],
    [new StateMachineError('x'), 'E_STATE_MACHINE'],
    [new GateError('x'), 'E_GATE'],
    [new ExecutorError('x'), 'E_EXECUTOR'],
  ] as const;
  for (const [e, code] of samples) {
    assert.equal((e as FeatureDevError).code, code);
  }
});

void test('isFeatureDevError recognizes subclasses', () => {
  assert.ok(isFeatureDevError(new ValidationError('x')));
  assert.ok(!isFeatureDevError(new Error('plain')));
  assert.ok(!isFeatureDevError('string'));
});

void test('toErrorPayload includes details when present', () => {
  const e = new ValidationError('bad', { key: 'foo' });
  const p = toErrorPayload(e);
  assert.equal(p.code, 'E_VALIDATION');
  assert.equal(p.message, 'bad');
  assert.deepEqual(p.details, { key: 'foo' });
});

void test('toErrorPayload handles unknown errors', () => {
  const p = toErrorPayload(new Error('x'));
  assert.equal(p.code, 'E_INTERNAL');
});
