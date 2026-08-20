/**
 * P0-3: confirm semantics — abort / revise / accept / continue change
 * the run state appropriately.
 *
 * Uses a stub subagent port that returns a real `pass` PhaseResult so
 * the workflow drives through all phases until the gate.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmFeatureDev } from '../../src/tools/confirm.ts';
import { statusFeatureDev } from '../../src/tools/status.ts';
import { resolveConfig } from '../../src/config.ts';
import { SubagentExecutor } from '../../src/executors/protocol.js';
import type { SubagentInvokeArgs, SubagentPort } from '../../src/executors/protocol.js';
import type { PhaseResult } from '../../src/types/contracts.js';
import type { Agent } from '../../src/dsh/sdk.js';

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-confirm-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const fd = join(dir, 'req', 'confirm-test');
  mkdirSync(join(fd, 'ai'), { recursive: true });
  writeFileSync(join(fd, 'tech-design.md'), '# Tech\n\ncontent\n');
  return dir;
}

const ctx = { packageRoot: process.cwd(), importMetaUrl: import.meta.url };

/** Always-pass subagent port. The workflow still validates artifact
 *  files; we pre-create the artifacts so checks pass. */
const PASS_PORT: SubagentPort = {
  async invoke(_args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
    return {
      rawText: '',
      result: { status: 'pass', summary: 'stub pass', artifacts: [], evidence: ['stub:pass'], changedFiles: [] },
    };
  },
};

async function runUntilGate(project: string) {
  const featureDir = join(project, 'req', 'confirm-test');
  // Pre-create artifacts the workflow expects
  writeFileSync(join(featureDir, 'mrd-original.md'), '# MRD\n\nbody\n', 'utf8');
  writeFileSync(join(featureDir, 'prd.md'), '# PRD\n\n' + 'x'.repeat(240) + '\n', 'utf8');
  writeFileSync(join(featureDir, 'tech-design.md'), '# Tech\n\n' + 'x'.repeat(240) + '\n', 'utf8');
  writeFileSync(join(featureDir, 'apps.json'), '[]', 'utf8');
  writeFileSync(join(featureDir, 'mrd-clarified.md'), '# Clarified\n', 'utf8');

  const config = resolveConfig({});
  const executor = new SubagentExecutor(PASS_PORT, {
    provider: 'spawn',
    defaultModel: { provider: 'p', model: 'm' },
    // The test never spawns a real subagent (PASS_PORT returns
    // synthetic results), so a brand-only placeholder Agent is enough.
    parent: {} as unknown as Agent,
  });
  // Inject the executor through the (re-wired) run tool by attaching
  // a custom dsh whose subagents.start calls our executor. Easiest:
  // attach a `dsh` with a custom start, but our run tool builds its
  // own executor. So we call the underlying workflow directly via
  // runWorkflow with a state we pre-create with one phase already done.
  const { StateRepository } = await import('../../src/runtime/state-repository.js');
  const repo = new StateRepository({ projectRoot: project, featureDir });
  // Wipe in case
  rmSync(repo.aiDir, { recursive: true, force: true });
  const state = repo.create({ workflow: 'implementation-plan', projectRoot: project, featureDir });
  // Manually mark the first 3 phases as pass so the next phase is PRD (which raises pre_prd)
  const { runWorkflow } = await import('../../src/workflow/runner.js').catch(() => import('../../src/workflows/runner.js'));
  // Walk through the phases manually by transitioning the state
  state.currentPhase = 'PRD';
  state.phaseHistory.push({ phase: 'MRD_READER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' });
  state.phaseHistory.push({ phase: 'CLARIFY', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' });
  state.phaseHistory.push({ phase: 'SERVICE_ROUTER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' });
  // Begin PRD
  state.phaseHistory.push({ phase: 'PRD', status: 'pending', startedAt: new Date().toISOString() });
  state.updatedAt = new Date().toISOString();
  repo.writeAtomicPublic(state);
  // Now run the workflow from PRD — it should produce a pass result, raise pre_prd, and stop
  await runWorkflow(state, { workflow: 'implementation-plan', projectRoot: project, featureDir, mrdUrl: 'https://x/y', options: { resume: false, unitTests: true, generateUnitTestsOnly: false, clarifyMode: 'dialogue' } }, { ctx, repo, created: false, executor, config, spawnBudget: { used: 0, max: 12 } });
  return { featureDir, executor, config };
}

void test('abort sets run status to aborted and does not silently complete', async () => {
  const project = makeProject();
  try {
    const { featureDir, executor, config } = await runUntilGate(project);
    void executor; void config;
    // 1) status before
    const before = await statusFeatureDev(ctx, { projectRoot: project, featureDir });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.data.pendingConfirmations, 1, `expected 1 pending; got ${before.data.pendingConfirmations}`);
    // 2) abort
    const r = await confirmFeatureDev(ctx, { projectRoot: project, featureDir, gate: 'pre_prd', choice: 'abort' });
    assert.equal(r.ok, true, JSON.stringify(r, null, 2));
    if (!r.ok) return;
    assert.equal(r.data.action, 'abort');
    // 3) status after — must be aborted (NOT completed)
    const after = await statusFeatureDev(ctx, { projectRoot: project, featureDir });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.notEqual(after.data.status, 'completed', 'abort MUST NOT be silently turned into completed');
    assert.equal(after.data.status, 'aborted');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('accept removes the gate but does not change phase', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilGate(project);
    const before = await statusFeatureDev(ctx, { projectRoot: project, featureDir });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    const phaseBefore = before.data.currentPhase;
    const r = await confirmFeatureDev(ctx, { projectRoot: project, featureDir, gate: 'pre_prd', choice: 'accept' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.action, 'continue');
    const after = await statusFeatureDev(ctx, { projectRoot: project, featureDir });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.data.currentPhase, phaseBefore);
    assert.equal(after.data.pendingConfirmations, 0);
    assert.equal(after.data.status, 'running');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('revise rewinds currentPhase to the gate-associated phase', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilGate(project);
    const r = await confirmFeatureDev(ctx, { projectRoot: project, featureDir, gate: 'pre_prd', choice: 'revise' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.action, 'rewind');
    const after = await statusFeatureDev(ctx, { projectRoot: project, featureDir });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.data.currentPhase, 'SERVICE_ROUTER');
    assert.equal(after.data.status, 'running');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('rejects choice not in the offered options', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilGate(project);
    const r = await confirmFeatureDev(ctx, { projectRoot: project, featureDir, gate: 'pre_prd', choice: 'banana' });
    assert.equal(r.ok, false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
