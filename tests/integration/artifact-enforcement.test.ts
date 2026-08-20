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

void test('missing required artifacts block a phase and do not raise its gate', async () => {
  const project = mkdtempSync(join(tmpdir(), 'dsh-artifact-block-'));
  const featureDir = join(project, 'req', 'missing');
  try {
    mkdirSync(join(project, '.git'), { recursive: true });
    mkdirSync(featureDir, { recursive: true });

    const result = await runFeatureDev(
      { packageRoot: PKG_ROOT, importMetaUrl: import.meta.url },
      {
        workflow: 'implementation-plan',
        projectRoot: project,
        featureDir,
        mrdUrl: 'https://example.com/mrd',
        options: {},
      }
    );
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));

    const state = new StateRepository({ projectRoot: project, featureDir }).read();
    assert.equal(state.status, 'blocked');
    assert.equal(state.currentPhase, 'BLOCKED');
    assert.equal(state.pendingConfirmations.length, 0);
    assert.equal(state.phaseHistory[0]?.status, 'failed');
    assert.match(state.lastPhaseResult?.evidence.join(' ') ?? '', /artifacts_missing/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
