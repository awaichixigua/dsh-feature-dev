import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFeatureDev } from '../../src/tools/run.js';
import { StateRepository } from '../../src/runtime/state-repository.js';

const here = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(here, '..', '..', '..');

void test('bugfix continues automatically after read-only LOCATE without a confirmation gate', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dsh-bugfix-gate-'));
  const featureDir = join(project, 'req', 'bugfix-gate');
  try {
    mkdirSync(join(project, '.git'), { recursive: true });
    mkdirSync(featureDir, { recursive: true });
    const result = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'bugfix',
        projectRoot: project,
        featureDir,
        bugDescription: 'POST /infer-schema fails to extract #{pid} before SQL formatting',
      }
    );

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    if (!result.ok) return;
    // The run allocates its bug-case directory before LOCATE. The offline
    // executor eventually blocks only because it cannot create the final
    // report artifact, not because the directory is missing.
    assert.equal(result.data.status, 'blocked');
    assert.equal(result.data.currentPhase, 'BLOCKED');
    assert.equal(result.data.pendingConfirmations.length, 0);
    assert.ok(result.data.lastPhaseResult?.summary);

    const state = new StateRepository({ projectRoot: project, featureDir }).read();
    assert.match(state.bugDescription ?? '', /infer-schema/);
    assert.ok(state.bugCaseDir?.startsWith('bugfix/1-'));
    assert.equal(state.phaseHistory.length, 3);
    assert.equal(state.phaseHistory[0]?.phase, 'LOCATE');
    assert.equal(state.phaseHistory[1]?.phase, 'CODE_FIX');
    assert.equal(state.phaseHistory[2]?.phase, 'REPORT');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
