/**
 * Gate bypass guard.
 *
 * Regression test: previously, `feature_dev_resume` ignored
 * `pendingConfirmations` on the persisted state. Calling resume
 * while a gate was open would silently skip the gate and roll the
 * workflow forward. Same gap existed in `feature_dev_run` via
 * `loadOrCreate` (it allowed the run to be marked 'running' again
 * with open gates still pending).
 *
 * This test reproduces the bug and asserts both code paths refuse
 * to advance while a gate is open.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFeatureDev } from '../../src/tools/run.js';
import { resumeFeatureDev } from '../../src/tools/resume.js';
import { confirmFeatureDev } from '../../src/tools/confirm.js';
import { SubagentExecutor } from '../../src/executors/protocol.js';
import { resolveConfig } from '../../src/config.js';
import { StateRepository } from '../../src/runtime/state-repository.js';
import type { SubagentInvokeArgs, SubagentPort } from '../../src/executors/protocol.js';
import type { PhaseResult } from '../../src/types/contracts.js';
import type { Agent } from '../../src/dsh/sdk.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-gate-bypass-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  const fd = join(dir, 'req', 'gate-test');
  mkdirSync(join(fd, 'ai'), { recursive: true });
  writeFileSync(join(fd, 'tech-design.md'), '# Tech\n\ncontent\n');
  return dir;
}

/** Always-pass subagent port so the workflow drives forward and hits
 *  the pre_prd gate (raised by PRD phase). */
const PASS_PORT: SubagentPort = {
  async invoke(_args: SubagentInvokeArgs): Promise<{ rawText: string; result?: PhaseResult }> {
    return {
      rawText: '',
      result: { status: 'pass', summary: 'stub pass', artifacts: [], evidence: ['stub:pass'], changedFiles: [] },
    };
  },
};

const CTX = { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url };

/** Drive the implementation-plan workflow until it parks at a
 *  pre_prd gate. */
async function runUntilPrePrdGate(project: string) {
  const featureDir = join(project, 'req', 'gate-test');
  // Pre-create artifacts so the workflow doesn't get distracted by
  // missing artifacts. PRD itself raises the gate regardless.
  writeFileSync(join(featureDir, 'mrd-original.md'), '# MRD\n\nbody\n', 'utf8');
  writeFileSync(join(featureDir, 'prd.md'), '# PRD\n\n' + 'x'.repeat(240) + '\n', 'utf8');
  writeFileSync(join(featureDir, 'mrd-clarified.md'), '# Clarified\n', 'utf8');

  const config = resolveConfig({});
  const executor = new SubagentExecutor(PASS_PORT, {
    provider: 'spawn',
    defaultModel: { provider: 'p', model: 'm' },
    parent: {} as unknown as Agent,
  });
  const repo = new StateRepository({ projectRoot: project, featureDir });
  // Wipe in case
  rmSync(repo.aiDir, { recursive: true, force: true });
  const state = repo.create({ workflow: 'implementation-plan', projectRoot: project, featureDir });
  // Mark the phases leading up to PRD as already-passed so the
  // workflow's resume logic doesn't re-run them.
  state.phaseHistory.push(
    { phase: 'MRD_READER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' },
    { phase: 'SERVICE_ROUTER', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' },
    { phase: 'BRANCH_GATE', status: 'pass', startedAt: state.startedAt, endedAt: state.startedAt, summary: 'stub' }
  );
  state.currentPhase = 'BRANCH_GATE';
  state.updatedAt = new Date().toISOString();
  repo.writeAtomicPublic(state);

  // Actually drive the workflow — it'll run PRD with the stub port,
  // get a pass result, validate the artifact, and raise pre_prd gate.
  const { drivePhases } = await import('../../src/workflows/phase-driver.js');
  const { implementationPlan } = await import('../../src/workflows/implementation-plan.js');
  void implementationPlan; // keep import; future tests may use it
  const { GateEngine } = await import('../../src/runtime/gate-engine.js');
  const { implementationPlan: _ignored } = await import('../../src/workflows/implementation-plan.js');
  void _ignored;
  const engine = new GateEngine(repo, config.strictGates);
  const inv = {
    workflow: 'implementation-plan' as const,
    projectRoot: project,
    featureDir,
    options: { resume: false, unitTests: true, generateUnitTestsOnly: false, clarifyMode: 'dialogue' as const },
  };
  void drivePhases; // not used directly; implementationPlan drives
  void engine;
  // Run the workflow — it should park at the pre_prd gate.
  await implementationPlan(state, inv, {
    ctx: CTX,
    repo,
    created: false,
    executor,
    config,
    spawnBudget: { used: 0, max: 12 },
  });
  return { featureDir, executor, config };
}

void test('resume is rejected while a pending confirmation is open', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilPrePrdGate(project);
    // 1) status before
    const before = await import('../../src/tools/status.js').then((m) =>
      m.statusFeatureDev(CTX, { projectRoot: project, featureDir })
    );
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.data.pendingConfirmations, 1, 'expected 1 pending confirmation from PRD gate');

    // 2) Resume is called WITHOUT resolving the gate. The bundle
    //    must refuse and surface the open gate so the user knows
    //    what to do.
    const resume = await resumeFeatureDev(CTX, { projectRoot: project, featureDir });
    assert.equal(resume.ok, false, 'resume must NOT silently advance past an open gate');
    if (resume.ok) return;
    assert.equal(resume.error.code, 'E_CONFLICT');
    assert.match(resume.error.message, /待确认事项/);
    // The error payload should include the open gate so the user
    // (or the model on the user's behalf) can resolve it.
    const details = resume.error.details as { pendingConfirmations?: Array<{ gate: string; options: string[] }> };
    assert.ok(details.pendingConfirmations, 'error must list pendingConfirmations');
    assert.equal(details.pendingConfirmations!.length, 1);
    assert.equal(details.pendingConfirmations![0]!.gate, 'pre_prd');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('run is rejected with ConflictError if a state file already has open gates', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilPrePrdGate(project);
    // Calling run again with the same featureDir hits loadOrCreate
    // which must ALSO refuse while a gate is open (defense in depth
    // — even if the user / model reaches for run instead of resume).
    const r2 = await runFeatureDev(CTX, {
      workflow: 'implementation-plan',
      projectRoot: project,
      featureDir,
      options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
    });
    assert.equal(r2.ok, false, 'run must not load a state file with open gates');
    if (r2.ok) return;
    assert.equal(r2.error.code, 'E_CONFLICT');
    assert.match(r2.error.message, /pending confirmation/i);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('confirm with an invalid choice does not advance the workflow', async () => {
  const project = makeProject();
  try {
    const { featureDir } = await runUntilPrePrdGate(project);
    // Sanity: 1 pending confirmation.
    const before = await import('../../src/tools/status.js').then((m) =>
      m.statusFeatureDev(CTX, { projectRoot: project, featureDir })
    );
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.data.pendingConfirmations, 1);

    // Invalid choice — neither in the gate's options list.
    const bad = await confirmFeatureDev(CTX, {
      projectRoot: project,
      featureDir,
      gate: 'pre_prd',
      choice: 'banana',
    });
    assert.equal(bad.ok, false, 'invalid choice must be rejected');

    // The pending confirmation is still open.
    const after = await import('../../src/tools/status.js').then((m) =>
      m.statusFeatureDev(CTX, { projectRoot: project, featureDir })
    );
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.data.pendingConfirmations, 1, 'invalid confirm must NOT consume the gate');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
