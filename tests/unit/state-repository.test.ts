/**
 * Unit tests for StateRepository.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateRepository } from '../../src/runtime/state-repository.ts';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-fd-test-'));
}

void test('create() writes atomic state file and run_start event', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const state = repo.create({
      workflow: 'code-gen-tdd',
      projectRoot: dir,
      featureDir: dir,
    });
    assert.ok(existsSync(repo.statePath));
    assert.equal(state.status, 'running');
    assert.equal(state.workflow, 'code-gen-tdd');
    assert.equal(state.currentPhase, 'INITIALIZED');
    const events = readFileSync(repo.eventsPath, 'utf8').trim().split('\n');
    assert.ok(events[0]!.includes('"run_start"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('create() twice throws conflict', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    repo.create({ workflow: 'influence-menu', projectRoot: dir, featureDir: dir });
    assert.throws(
      () => repo.create({ workflow: 'influence-menu', projectRoot: dir, featureDir: dir }),
      /already exists/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('begin/end phase appends history and rewrites MD', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const s = repo.create({ workflow: 'code-gen-tdd', projectRoot: dir, featureDir: dir });
    repo.beginPhase(s, 'PHASE1_TEST_SPEC');
    repo.endPhase(s, 'PHASE1_TEST_SPEC', {
      status: 'pass',
      summary: 'ok',
      artifacts: [`${dir}/ai/test_spec.md`],
      evidence: ['phase1:placeholder'],
      changedFiles: [],
    });
    const reread = repo.read();
    assert.equal(reread.phaseHistory.length, 1);
    assert.equal(reread.phaseHistory[0]!.status, 'pass');
    assert.ok(existsSync(repo.mdPath));
    const md = readFileSync(repo.mdPath, 'utf8');
    assert.match(md, /最近阶段结果/);
    assert.match(md, /PHASE1_TEST_SPEC/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('transition(COMPLETED) flips status to completed', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const s = repo.create({ workflow: 'archive', projectRoot: dir, featureDir: dir });
    repo.transition(s, 'COMPLETED');
    assert.equal(repo.read().status, 'completed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('loadOrCreate recovers a legacy false completion as a fresh run', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const old = repo.create({ workflow: 'bugfix', projectRoot: dir, featureDir: dir });
    repo.beginPhase(old, 'LOCATE');
    repo.endPhase(old, 'LOCATE', {
      status: 'block',
      summary: 'legacy subagent failure',
      artifacts: [],
      evidence: [],
      changedFiles: [],
      blocker: 'legacy adapter error',
    });
    repo.transition(old, 'COMPLETED');

    const loaded = repo.loadOrCreate({
      workflow: 'bugfix',
      projectRoot: dir,
      featureDir: dir,
    });

    assert.equal(loaded.created, true);
    assert.notEqual(loaded.state.runId, old.runId);
    assert.equal(loaded.state.status, 'running');
    assert.equal(loaded.state.currentPhase, 'INITIALIZED');
    assert.equal(loaded.state.phaseHistory.length, 0);
    assert.match(loaded.state.notes?.[0] ?? '', /false completion/);
    const historyDir = join(repo.aiDir, 'history');
    assert.ok(existsSync(historyDir));
    assert.ok(readdirSync(historyDir).some((name) => name.includes(old.runId)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('loadOrCreate still rejects a genuinely completed run', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const state = repo.create({ workflow: 'archive', projectRoot: dir, featureDir: dir });
    repo.beginPhase(state, 'REPORT');
    repo.endPhase(state, 'REPORT', {
      status: 'pass',
      summary: 'done',
      artifacts: [],
      evidence: ['report:ok'],
      changedFiles: [],
    });
    repo.transition(state, 'COMPLETED');

    assert.throws(() => repo.loadOrCreate({
      workflow: 'archive',
      projectRoot: dir,
      featureDir: dir,
    }), /terminal state/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('loadOrCreate persists bug context and rewinds a blocked retry', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const state = repo.create({
      workflow: 'bugfix',
      projectRoot: dir,
      featureDir: dir,
      bugDescription: 'original context',
    });
    repo.beginPhase(state, 'LOCATE');
    repo.endPhase(state, 'LOCATE', {
      status: 'block',
      summary: 'retry me',
      artifacts: [],
      evidence: ['locate:block'],
      changedFiles: [],
      blocker: 'more context',
    });
    repo.transition(state, 'BLOCKED');

    const loaded = repo.loadOrCreate({
      workflow: 'bugfix',
      projectRoot: dir,
      featureDir: dir,
      bugDescription: 'complete context with SQL',
    });

    assert.equal(loaded.created, false);
    assert.equal(loaded.state.status, 'running');
    assert.equal(loaded.state.currentPhase, 'INITIALIZED');
    assert.equal(loaded.state.phaseHistory.length, 0);
    assert.equal(loaded.state.bugDescription, 'complete context with SQL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('bumpRepair increments counter and logs repair event', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    const s = repo.create({ workflow: 'code-gen-tdd', projectRoot: dir, featureDir: dir });
    repo.bumpRepair(s, 'PHASE3_REVIEW', 'PHASE2_REPAIR', 'block');
    assert.equal(repo.read().repairCount, 1);
    const events = readFileSync(repo.eventsPath, 'utf8').trim().split('\n');
    assert.ok(events.some((e) => e.includes('"repair"')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('schemaVersion mismatch throws', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    repo.create({ workflow: 'influence-menu', projectRoot: dir, featureDir: dir });
    const txt = readFileSync(repo.statePath, 'utf8');
    const bad = txt.replace('"1.0.0"', '"0.9.0"');
    writeFileSync(repo.statePath, bad, 'utf8');
    assert.throws(() => repo.read(), /Incompatible/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('state.json is written atomically (no .tmp leftovers)', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    repo.create({ workflow: 'influence-menu', projectRoot: dir, featureDir: dir });
    const entries = readdirSync(repo.aiDir);
    const stray = entries.filter((n: string) => n.includes('.tmp-'));
    assert.equal(stray.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('state.json size and mtime are reasonable', () => {
  const dir = makeTmp();
  try {
    const repo = new StateRepository({ projectRoot: dir, featureDir: dir });
    repo.create({ workflow: 'influence-menu', projectRoot: dir, featureDir: dir });
    const st = statSync(repo.statePath);
    assert.ok(st.size > 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
