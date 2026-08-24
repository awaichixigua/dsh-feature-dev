import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoCommitAndPush, type GitCommandRunner } from '../../src/runtime/auto-commit.ts';

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
