/**
 * Unit tests for `RunMetricsReporter`.
 *
 * Focus areas:
 *   - startRun writes the expected state file under the
 *     reporter's `metricsHome`, with the right branch / repo / status
 *   - startRun on an existing in_progress state returns
 *     `resumed: true` and does NOT clobber the run_id
 *   - startTimer + stopTimer produces a single non-abandoned timer
 *     with the right duration
 *   - finishRun on a no-ARTEFACT run marks state as `no_effect`
 *     and does NOT enqueue
 *   - finishRun on a run with no real git repo degrades gracefully
 *     (we never throw past the reporter)
 *
 * The reporter normally shells out to `git`; here we run it against
 * the test environment's CWD (which is the dsh-feature-dev repo)
 * and just assert on the observable side-effects.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunMetricsReporter } from '../../src/metrics/reporter.ts';
import { stateIdentity } from '../../src/metrics/state.ts';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-metrics-'));
}

function stateFileFor(home: string, projectRoot: string, featureDir: string, sessionId?: string): string {
  return join(home, 'runs', `${stateIdentity(projectRoot, featureDir, { type: 'full', target_feature_id: null }, 'code_gen', null, null, sessionId ?? null)}.json`);
}

function runGit(dir: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

void test('startRun writes state file with in_progress status', () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    const result = r.startRun({
      projectRoot,
      featureDir,
      runType: 'code_gen',
      sessionId: 'sess-1',
    });
    assert.equal(result.resumed, false);
    assert.equal(result.status, 'in_progress');
    const stateFile = stateFileFor(home, projectRoot, featureDir, 'sess-1');
    assert.ok(existsSync(stateFile), `state file should exist at ${stateFile}`);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.run_id, result.run_id);
    assert.equal(state.run_type, 'code_gen');
    assert.equal(state.status, 'in_progress');
    assert.equal(state.session_id, 'sess-1');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('startRun on existing in_progress state returns resumed=true', () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    const first = r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    const second = r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    assert.equal(second.resumed, true);
    assert.equal(second.run_id, first.run_id);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('startRun isolates separate workflow run ids but resumes the same one', () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    const first = r.startRun({ projectRoot, featureDir, runType: 'code_gen', sessionId: 'workflow-1' });
    const resumed = r.startRun({ projectRoot, featureDir, runType: 'code_gen', sessionId: 'workflow-1' });
    const separate = r.startRun({ projectRoot, featureDir, runType: 'code_gen', sessionId: 'workflow-2' });
    assert.equal(resumed.run_id, first.run_id);
    assert.equal(resumed.resumed, true);
    assert.notEqual(separate.run_id, first.run_id);
    assert.equal(separate.resumed, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('startTimer + stopTimer records a single non-abandoned timer', () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    r.startTimer({ projectRoot, featureDir, runType: 'code_gen', category: 'implementation' });
    // Simulate elapsed time by starting a second timer — should mark the
    // first as abandoned, then we stop the second.
    r.startTimer({ projectRoot, featureDir, runType: 'code_gen', category: 'test_generation' });
    const stopped = r.stopTimer({ projectRoot, featureDir, runType: 'code_gen', category: 'test_generation' });
    assert.equal(stopped.ignored, undefined);
    assert.equal(stopped.category, 'test_generation');
    const stateFile = stateFileFor(home, projectRoot, featureDir);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.timers.length, 2);
    assert.equal(state.timers[0]!.abandoned, true);
    assert.equal(state.timers[1]!.abandoned, false);
    assert.equal(state.timers[1]!.category, 'test_generation');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('stopTimer with no active timer is a no-op', () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    const stopped = r.stopTimer({ projectRoot, featureDir, runType: 'code_gen', category: 'implementation' });
    assert.equal(stopped.ignored, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('finishRun on a no-effect run marks state no_effect and skips the queue', async () => {
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    const result = await r.finishRun({ projectRoot, featureDir, runType: 'code_gen' });
    assert.equal(result.status, 'no_effect');
    assert.equal(result.run_id.length, 36); // UUID
    // No envelope should have been enqueued.
    const pendingDir = join(home, 'queue', 'pending');
    assert.equal(existsSync(pendingDir), true);
    assert.equal(existsSync(join(pendingDir, `${result.run_id}.json`)), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('flushQueue on empty pending returns processed=0', async () => {
  const home = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    const result = await r.flushQueue();
    assert.equal(result.processed, 0);
    assert.deepEqual(result.results, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

void test('reporter degrades gracefully when project is not a git repo', () => {
  // No git init: startRun should still write state with placeholder values
  // instead of throwing.
  const home = makeTmp();
  const projectRoot = makeTmp();
  const featureDir = makeTmp();
  try {
    const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost:0/dummy' });
    const result = r.startRun({ projectRoot, featureDir, runType: 'code_gen' });
    assert.equal(result.status, 'in_progress');
    const stateFile = stateFileFor(home, projectRoot, featureDir);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    // The placeholder branch + requirement id avoid the run being lost.
    assert.equal(state.branch, 'detached');
    assert.equal(state.requirement_id, '0');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(featureDir, { recursive: true, force: true });
  }
});

void test('finishRun uses the nested Git root when projectRoot is only a workspace', async () => {
  const home = makeTmp();
  const workspace = makeTmp();
  const repo = join(workspace, 'service');
  const featureDir = join(repo, 'req', 'change');
  try {
    // projectRoot deliberately is not a Git tree; the changed file lives in
    // the nested repository that contains featureDir.
    mkdirSync(featureDir, { recursive: true });
    runGit(repo, ['init', '-q']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    runGit(repo, ['config', 'user.name', 'Test']);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'main.ts'), 'export const value = 1;\n');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-qm', 'baseline']);

    const originalFetch = globalThis.fetch;
    const payloads: unknown[] = [];
    globalThis.fetch = (async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response('{"ok":true}', { status: 201 });
    }) as typeof fetch;
    try {
      const r = new RunMetricsReporter({ metricsHome: home, lineChangesEnabled: false, reportUrl: 'http://localhost/dummy' });
      r.startRun({ projectRoot: workspace, featureDir, runType: 'code_gen', sessionId: 'nested-run' });
      writeFileSync(join(repo, 'src', 'main.ts'), 'export const value = 1;\nexport const next = 2;\n');
      const result = await r.finishRun({ projectRoot: workspace, featureDir, runType: 'code_gen', sessionId: 'nested-run' });
      const stateFile = stateFileFor(home, workspace, featureDir, 'nested-run');
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(result.status, 'reported', JSON.stringify(state));
      assert.equal(payloads.length, 1);
      const payload = payloads[0] as { metrics: { ai_production_added_lines: number } };
      assert.equal(payload.metrics.ai_production_added_lines, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
