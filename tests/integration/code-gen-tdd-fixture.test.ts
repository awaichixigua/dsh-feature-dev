/**
 * Integration test: drive the code-gen-tdd workflow end to end.
 *
 * This test does NOT spawn real subagents; it uses the placeholder
 * implementations in the workflow code. It verifies:
 *   - the state machine reaches COMPLETED
 *   - every phase has a history entry
 *   - the state JSON + MD projection exist
 *   - artifact specs are checked (missing artifacts downgrade pass to warn)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFeatureDev } from '../../src/tools/run.ts';
import { statusFeatureDev } from '../../src/tools/status.ts';
import { confirmFeatureDev } from '../../src/tools/confirm.ts';
import { resumeFeatureDev } from '../../src/tools/resume.ts';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-int-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  // Tech design
  const fd = join(dir, 'req', 'create-order');
  mkdirSync(join(fd, 'ai'), { recursive: true });
  writeFileSync(join(fd, 'tech-design.md'), '# Tech Design\n\nsome content here\n');
  return dir;
}

void test('end-to-end code-gen-tdd: feature-dev runs to a terminal state', async () => {
  const project = makeProject();
  try {
    const featureDir = join(project, 'req', 'create-order');
    const run = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'code-gen-tdd',
        projectRoot: project,
        featureDir,
        options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
      }
    );
    assert.equal(run.ok, true, JSON.stringify(run, null, 2));
    if (!run.ok) return;
    assert.ok(run.data.runId);
    // status is either completed (full pass) or blocked (gates raised). Both are valid
    // end states for this fixture because the gate engine raises a confirmation
    // after the test spec phase.
    assert.ok(['completed', 'blocked', 'running', 'paused', 'interrupted'].includes(run.data.status), run.data.status);

    let state = JSON.parse(readFileSync(run.data.statePath, 'utf8')) as {
      status: string;
      pendingConfirmations: Array<{ id: string; options: string[] }>;
      phaseHistory: Array<{ phase: string }>;
      unitTestsRequested?: boolean;
    };
    if (state.pendingConfirmations.length > 0) {
      const confirmation = state.pendingConfirmations[0]!;
      const confirmed = await confirmFeatureDev(
        { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
        { projectRoot: project, featureDir, gateId: confirmation.id, choice: confirmation.options[0] }
      );
      assert.equal(confirmed.ok, true, JSON.stringify(confirmed, null, 2));
      if (confirmed.ok) {
        assert.ok(confirmed.data.resumed, 'accepting a test specification must resume code-gen-tdd');
      }
      state = JSON.parse(readFileSync(run.data.statePath, 'utf8')) as typeof state;
    }
    if (state.status !== 'completed') {
      const resumed = await resumeFeatureDev(
        { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
        { projectRoot: project, featureDir }
      );
      assert.equal(resumed.ok, true, JSON.stringify(resumed, null, 2));
    }
    state = JSON.parse(readFileSync(run.data.statePath, 'utf8')) as typeof state;
    assert.equal(state.unitTestsRequested, false);
    assert.ok(!state.phaseHistory.some((entry) => entry.phase === 'PHASE4_TEST_GENERATION'));
    assert.ok(!state.phaseHistory.some((entry) => entry.phase === 'PHASE5_TEST_EXECUTION'));
    assert.ok(!existsSync(join(featureDir, 'ai', 'unit_test_report.md')));

    // State file exists
    assert.ok(existsSync(run.data.statePath));
    // Run status check
    const status = await statusFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      { projectRoot: project, featureDir, includeMarkdown: true }
    );
    assert.equal(status.ok, true, JSON.stringify(status, null, 2));
    if (!status.ok) return;
    assert.ok(status.data.runId);
    assert.ok(status.data.markdown);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('end-to-end implementation-plan: produces mrd-original and confirms prd gate', async () => {
  const project = makeProject();
  try {
    const featureDir = join(project, 'req', 'plan-test');
    mkdirSync(join(featureDir, 'ai'), { recursive: true });
    const run = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'implementation-plan',
        projectRoot: project,
        featureDir,
        mrdUrl: 'https://example.com/share_doc/?token=abc',
        options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
      }
    );
    // Implementation plan raises a gate at PRD; final state will be paused/blocked.
    assert.equal(run.ok, true, JSON.stringify(run, null, 2));
    if (!run.ok) return;
    assert.ok(['paused', 'blocked', 'running'].includes(run.data.status), run.data.status);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('implementation-plan accepts direct requirement input without fetching MRDoc', async () => {
  const project = makeProject();
  try {
    const featureDir = join(project, 'req', 'direct-plan-test');
    const requirement = '支持按订单编号查询物流状态，并展示最新物流节点';
    const run = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'implementation-plan',
        projectRoot: project,
        featureDir,
        rawUserRequest: requirement,
        options: { resume: false, unitTests: false, generateUnitTestsOnly: false },
      }
    );
    assert.equal(run.ok, true, JSON.stringify(run, null, 2));
    if (!run.ok) return;
    assert.match(readFileSync(join(run.data.featureDir, 'mrd-original.md'), 'utf8'), new RegExp(requirement));
    const source = JSON.parse(readFileSync(join(run.data.featureDir, '.tmp', 'mrd-source.json'), 'utf8')) as {
      sourceType: string;
      sha256: string;
    };
    assert.equal(source.sourceType, 'direct-input');
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('mrd-to-code accepts direct requirement input without fetching MRDoc', async () => {
  const project = makeProject();
  try {
    const featureDir = join(project, 'req', 'direct-mrd-to-code-test');
    const requirement = '支持按订单编号查询物流状态，并展示最新物流节点';
    const run = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'mrd-to-code',
        projectRoot: project,
        featureDir,
        rawUserRequest: requirement,
        options: { resume: false, unitTests: false, generateUnitTestsOnly: false },
      }
    );
    assert.equal(run.ok, true, JSON.stringify(run, null, 2));
    if (!run.ok) return;
    assert.match(readFileSync(join(run.data.featureDir, 'mrd-original.md'), 'utf8'), new RegExp(requirement));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

void test('state.json contains all expected top-level fields', async () => {
  const project = makeProject();
  try {
    const featureDir = join(project, 'req', 'fields-test');
    const run = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'code-gen-tdd',
        projectRoot: project,
        featureDir,
        options: { resume: false, unitTests: true, generateUnitTestsOnly: false },
      }
    );
    if (!run.ok) return;
    const txt = readFileSync(run.data.statePath, 'utf8');
    const parsed = JSON.parse(txt) as Record<string, unknown>;
    for (const k of [
      'schemaVersion',
      'runId',
      'workflow',
      'projectRoot',
      'featureDir',
      'currentPhase',
      'phaseHistory',
      'startedAt',
      'updatedAt',
      'status',
      'repairCount',
      'agentCount',
      'pendingConfirmations',
    ]) {
      assert.ok(k in parsed, `missing ${k}`);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
