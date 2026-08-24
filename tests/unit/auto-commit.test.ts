import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoCommitAndPush, autoCommitAndPushServices, type GitCommandRunner } from '../../src/runtime/auto-commit.ts';

void test('autoCommitAndPush stages newly created files, commits, and pushes', () => {
  const calls: string[][] = [];
  const git: GitCommandRunner = {
    run(_cwd, args) {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo';
      if (args[0] === 'status') return '?? src/new-file.ts\n M src/existing.ts';
      if (args[0] === 'diff') return 'src/new-file.ts\nsrc/existing.ts';
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123';
      return '';
    },
  };

  const result = autoCommitAndPush({ cwd: '/repo/req/feature', workflow: 'code-gen-tdd', runId: 'run-1' }, git);

  assert.deepEqual(result, { status: 'committed_and_pushed', repository: '/repo', commit: 'abc123' });
  assert.ok(calls.some((args) => args[0] === 'add' && args[1] === '--all'));
  assert.ok(calls.some((args) => args[0] === 'push'));
});

void test('autoCommitAndPush does not create an empty commit', () => {
  const calls: string[][] = [];
  const git: GitCommandRunner = {
    run(_cwd, args) {
      calls.push(args);
      if (args[0] === 'rev-parse') return '/repo';
      if (args[0] === 'status') return '';
      return '';
    },
  };

  const result = autoCommitAndPush({ cwd: '/repo', workflow: 'bugfix', runId: 'run-2' }, git);

  assert.deepEqual(result, { status: 'no_changes', repository: '/repo' });
  assert.equal(calls.some((args) => args[0] === 'add'), false);
});

void test('autoCommitAndPushServices stages and pushes every writable service', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-auto-commit-services-'));
  const featureName = '2.0.0_1_multi-service';
  const primaryFeature = join(workspace, 'primary', 'req', featureName);
  const collaboratorFeature = join(workspace, 'payment', 'req', featureName);
  const calls: Array<{ cwd: string; args: string[] }> = [];
  try {
    mkdirSync(primaryFeature, { recursive: true });
    mkdirSync(collaboratorFeature, { recursive: true });
    writeFileSync(join(primaryFeature, 'apps.json'), JSON.stringify({
      primary: ['primary'],
      collaborators: ['payment'],
      repositories: { primary: 'primary', payment: 'payment' },
    }));
    const git: GitCommandRunner = {
      run(cwd, args) {
        calls.push({ cwd, args });
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return cwd;
        if (args[0] === 'status') return '?? src/new-file.ts';
        if (args[0] === 'diff') return 'src/new-file.ts';
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `commit-${cwd}`;
        return '';
      },
    };

    const result = autoCommitAndPushServices({
      cwd: primaryFeature,
      projectRoot: workspace,
      workflow: 'code-gen-tdd',
      runId: 'run-3',
    }, git);

    assert.equal(result.status, 'committed_and_pushed');
    assert.deepEqual(result.services?.map((service) => service.service), ['primary', 'payment']);
    const stagedIn = calls.filter((call) => call.args[0] === 'add' && call.args[1] === '--all').map((call) => call.cwd);
    assert.deepEqual(stagedIn, [primaryFeature, collaboratorFeature]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

void test('autoCommitAndPushServices limits a feature run to mapped services', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-auto-commit-feature-'));
  const featureName = '2.0.0_1_multi-service';
  const primaryFeature = join(workspace, 'primary', 'req', featureName);
  const paymentFeature = join(workspace, 'payment', 'req', featureName);
  const catalogFeature = join(workspace, 'catalog', 'req', featureName);
  const calls: Array<{ cwd: string; args: string[] }> = [];
  try {
    for (const featureDir of [primaryFeature, paymentFeature, catalogFeature]) {
      mkdirSync(featureDir, { recursive: true });
    }
    writeFileSync(join(primaryFeature, 'apps.json'), JSON.stringify({
      primary: ['primary'],
      collaborators: ['payment', 'catalog'],
      repositories: { primary: 'primary', payment: 'payment', catalog: 'catalog' },
    }));
    writeFileSync(join(primaryFeature, 'feature-map.json'), JSON.stringify({
      features: [{ id: 'F-001', name: '支付订单', services: ['primary', 'payment'] }],
    }));
    const git: GitCommandRunner = {
      run(cwd, args) {
        calls.push({ cwd, args });
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return cwd;
        if (args[0] === 'status') return '?? src/new-file.ts';
        if (args[0] === 'diff') return 'src/new-file.ts';
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return `commit-${cwd}`;
        return '';
      },
    };

    const result = autoCommitAndPushServices({
      cwd: primaryFeature,
      projectRoot: workspace,
      workflow: 'code-gen-tdd',
      runId: 'run-feature',
      featureId: 'F-001',
    }, git);

    assert.deepEqual(result.services?.map((service) => service.service), ['primary', 'payment']);
    const stagedIn = calls.filter((call) => call.args[0] === 'add').map((call) => call.cwd);
    assert.deepEqual(stagedIn, [primaryFeature, paymentFeature]);
    assert.equal(stagedIn.includes(catalogFeature), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
