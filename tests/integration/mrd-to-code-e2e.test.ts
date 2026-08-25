import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runFeatureDev } from '../../src/tools/run.js';
import { resumeFeatureDev } from '../../src/tools/resume.js';
import { confirmFeatureDev } from '../../src/tools/confirm.js';
import { StateRepository } from '../../src/runtime/state-repository.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');
const CTX = { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url };

function makeProject(): { project: string; featureDir: string } {
  const project = mkdtempSync(join(tmpdir(), 'dsh-mrd-e2e-'));
  const featureName = '2.0.0_103111_e2e';
  const featureDir = join(project, 'req', featureName);
  const stagingDir = join(project, '.tmp', featureName);
  mkdirSync(join(featureDir, 'ai'), { recursive: true });
  mkdirSync(stagingDir, { recursive: true });

  const artifacts: Array<[string, string]> = [
    ['mrd-original.md', '# MRD\n\n' + 'x'.repeat(300)],
    ['mrd-clarified.md', '# Clarified MRD\n\n' + 'x'.repeat(300)],
    ['prd.md', '# PRD\n\n' + 'x'.repeat(300)],
    ['tech-design.md', '# Tech Design\n\n' + 'x'.repeat(300)],
    ['feature-map.json', JSON.stringify({ version: 1, features: [{ id: 'F-001', name: 'E2E feature', services: ['fixture-service'] }] })],
    ['ai/test_spec.md', '# Test Spec\n\n' + 'x'.repeat(180)],
    ['ai/code-review.md', '# Code Review\n\n' + 'x'.repeat(180)],
    ['ai/unit_test_report.md', '# Test Report\n\n' + 'x'.repeat(180)],
    ['archive-report.md', '# Archive\n\n' + 'x'.repeat(180)],
  ];
  for (const [path, contents] of artifacts) {
    writeFileSync(join(featureDir, path), contents, 'utf8');
  }

  writeFileSync(join(stagingDir, 'mrd-original.md'), '# MRD\n\n' + 'x'.repeat(300), 'utf8');
  writeFileSync(join(stagingDir, 'apps.json'), JSON.stringify({
    primary: ['fixture-service'],
    collaborators: [],
    repositories: { 'fixture-service': '.' },
  }, null, 2), 'utf8');

  // BRANCH_GATE deliberately performs real Git operations. Give the fixture
  // a minimal versioned release branch and local bare origin so the E2E test
  // exercises the production path without depending on a network remote.
  writeFileSync(join(project, '.gitignore'), '.tmp/\n.remote.git/\n', 'utf8');
  execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: project });
  execFileSync('git', ['switch', '-c', 'v2.2.10-release'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['add', '.gitignore', 'req'], { cwd: project });
  execFileSync('git', ['commit', '-m', 'fixture baseline'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['init', '--bare', '.remote.git'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', join(project, '.remote.git')], { cwd: project });
  execFileSync('git', ['push', '-u', 'origin', 'v2.2.10-release'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['branch', 'v2.2.9-release'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['push', 'origin', 'v2.2.9-release'], { cwd: project, stdio: 'ignore' });
  // Simulate a single-branch/restricted clone: a normal fetch sees only the
  // older release. BRANCH_GATE must query remote heads and explicitly fetch
  // v2.2.10-release before creating the requirement branch.
  execFileSync('git', ['config', '--unset-all', 'remote.origin.fetch'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['config', '--add', 'remote.origin.fetch', '+refs/heads/v2.2.9-release:refs/remotes/origin/v2.2.9-release'], { cwd: project });
  execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/v2.2.10-release'], { cwd: project });
  return { project, featureDir };
}

void test('mrd-to-code completes implementation-plan, code-gen-tdd, and archive as one run', async () => {
  const { project, featureDir } = makeProject();
  try {
    const started = await runFeatureDev(CTX, {
      workflow: 'mrd-to-code',
      projectRoot: project,
      featureDir,
      mrdUrl: 'https://example.com/mrd',
      options: {},
    });
    assert.equal(started.ok, true, JSON.stringify(started, null, 2));

    if (!started.ok) return;
    let currentFeatureDir = started.data.featureDir;
    let repo = new StateRepository({ projectRoot: project, featureDir: currentFeatureDir, runId: started.data.runId });
    const visited = new Set<string>();
    for (let step = 0; step < 30; step += 1) {
      const state = repo.read();
      if (state.featureDir !== currentFeatureDir) {
        currentFeatureDir = state.featureDir;
        repo = new StateRepository({ projectRoot: project, featureDir: currentFeatureDir, runId: state.runId });
      }
      if (state.activeWorkflow) visited.add(state.activeWorkflow);
      if (state.status === 'completed') break;

      if (state.pendingConfirmations.length > 0) {
        const confirmation = state.pendingConfirmations[0]!;
        const choice = confirmation.options.find((item) => item !== 'revise' && item !== 'abort')!;
        const confirmed = await confirmFeatureDev(CTX, {
          projectRoot: project,
          featureDir: currentFeatureDir,
          runId: state.runId,
          gateId: confirmation.id,
          choice,
        });
        assert.equal(confirmed.ok, true, JSON.stringify(confirmed, null, 2));
      } else {
        const resumed = await resumeFeatureDev(CTX, {
          projectRoot: project,
          featureDir: currentFeatureDir,
          runId: state.runId,
        });
        assert.equal(resumed.ok, true, JSON.stringify(resumed, null, 2));
        if (resumed.ok && resumed.data.featureDir !== currentFeatureDir) {
          currentFeatureDir = resumed.data.featureDir;
          repo = new StateRepository({ projectRoot: project, featureDir: currentFeatureDir, runId: state.runId });
        }
      }
    }

    const finalState = repo.read();
    assert.equal(finalState.workflow, 'mrd-to-code');
    assert.equal(finalState.activeWorkflow, undefined, JSON.stringify(finalState, null, 2));
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.currentPhase, 'COMPLETED');
    assert.ok(visited.has('implementation-plan'));
    assert.ok(visited.has('code-gen-tdd'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'MRD_READER'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'PHASE6_SUMMARY'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'REPORT'));
    assert.equal(finalState.agentCount, 12);

    const events = readFileSync(repo.eventsPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { kind: string });
    assert.equal(events.filter((event) => event.kind === 'run_end').length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
