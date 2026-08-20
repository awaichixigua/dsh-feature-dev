/**
 * Unit tests for Gate Engine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateRepository } from '../../src/runtime/state-repository.ts';
import { GateEngine, GATES } from '../../src/runtime/gate-engine.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-gate-'));
  const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
  const state = repo.create({ workflow: 'implementation-plan', projectRoot: dir, featureDir: dir });
  const engine = new GateEngine(repo, true);
  return { dir, repo, state, engine };
}

void test('raise() appends a pending confirmation', () => {
  const { dir, state, engine, repo } = setup();
  try {
    engine.raise(state, 'pre_prd');
    assert.equal(state.pendingConfirmations.length, 1);
    assert.equal(state.pendingConfirmations[0]!.gate, 'pre_prd');
    assert.equal(state.status, 'paused');
    assert.ok(repo.exists());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolve() removes the pending confirmation', () => {
  const { dir, state, engine } = setup();
  try {
    engine.raise(state, 'pre_prd');
    const id = state.pendingConfirmations[0]!.id;
    engine.resolve(state, id, 'accept');
    assert.equal(state.pendingConfirmations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolve() with unknown id throws', () => {
  const { dir, state, engine } = setup();
  try {
    assert.throws(() => engine.resolve(state, 'no-such', 'accept'), /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('GATES registry has all expected gates', () => {
  for (const k of ['post_locate', 'pre_test_spec', 'post_test_spec', 'pre_prd', 'pre_tech_design', 'pre_archive', 'pre_kb_update']) {
    assert.ok(GATES[k as keyof typeof GATES]);
  }
});

void test('non-strict mode auto-accepts soft gates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-gate2-'));
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const state = repo.create({ workflow: 'archive', projectRoot: dir, featureDir: dir });
    const engine = new GateEngine(repo, false);
    const conf = engine.raise(state, 'pre_kb_update'); // non-blocking
    assert.equal(conf.id, 'auto');
    assert.equal(state.pendingConfirmations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
