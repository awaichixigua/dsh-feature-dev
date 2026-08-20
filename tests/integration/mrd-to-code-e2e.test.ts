import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFeatureDev } from '../../src/tools/run.js';
import { resumeFeatureDev } from '../../src/tools/resume.js';
import { confirmFeatureDev } from '../../src/tools/confirm.js';
import { StateRepository } from '../../src/runtime/state-repository.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');
const CTX = { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url };

function makeProject(): { project: string; featureDir: string } {
  const project = mkdtempSync(join(tmpdir(), 'dsh-mrd-e2e-'));
  const featureDir = join(project, 'req', 'e2e');
  mkdirSync(join(project, '.git'), { recursive: true });
  mkdirSync(join(featureDir, 'ai'), { recursive: true });

  const artifacts: Array<[string, string]> = [
    ['mrd-original.md', '# MRD\n\n' + 'x'.repeat(300)],
    ['prd.md', '# PRD\n\n' + 'x'.repeat(300)],
    ['tech-design.md', '# Tech Design\n\n' + 'x'.repeat(300)],
    ['ai/test_spec.md', '# Test Spec\n\n' + 'x'.repeat(180)],
    ['ai/code-review.md', '# Code Review\n\n' + 'x'.repeat(180)],
    ['ai/unit_test_report.md', '# Test Report\n\n' + 'x'.repeat(180)],
    ['archive-report.md', '# Archive\n\n' + 'x'.repeat(180)],
  ];
  for (const [path, contents] of artifacts) {
    writeFileSync(join(featureDir, path), contents, 'utf8');
  }
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

    const repo = new StateRepository({ projectRoot: project, featureDir });
    const visited = new Set<string>();
    for (let step = 0; step < 30; step += 1) {
      const state = repo.read();
      if (state.activeWorkflow) visited.add(state.activeWorkflow);
      if (state.status === 'completed') break;

      if (state.pendingConfirmations.length > 0) {
        const confirmation = state.pendingConfirmations[0]!;
        const choice = confirmation.options.find((item) => item !== 'revise' && item !== 'abort')!;
        const confirmed = await confirmFeatureDev(CTX, {
          projectRoot: project,
          featureDir,
          gateId: confirmation.id,
          choice,
        });
        assert.equal(confirmed.ok, true, JSON.stringify(confirmed, null, 2));
      } else {
        const resumed = await resumeFeatureDev(CTX, { projectRoot: project, featureDir });
        assert.equal(resumed.ok, true, JSON.stringify(resumed, null, 2));
      }
    }

    const finalState = repo.read();
    assert.equal(finalState.workflow, 'mrd-to-code');
    assert.equal(finalState.activeWorkflow, undefined);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.currentPhase, 'COMPLETED');
    assert.ok(visited.has('implementation-plan'));
    assert.ok(visited.has('code-gen-tdd'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'MRD_READER'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'PHASE6_SUMMARY'));
    assert.ok(finalState.phaseHistory.some((entry) => entry.phase === 'REPORT'));
    assert.equal(finalState.agentCount, 15);

    const events = readFileSync(repo.eventsPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { kind: string });
    assert.equal(events.filter((event) => event.kind === 'run_end').length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
