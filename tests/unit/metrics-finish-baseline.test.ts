/**
 * Unit tests for `resolveFinishBaseline`.
 *
 * The function decides which baseline the metrics report diffs
 * against. The interesting case is when HEAD has advanced while
 * the AI was running — naively diffing the original baseline
 * would count the user's MR as AI work. The rebased branch of
 * the rule-set catches that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFinishBaseline } from '../../src/metrics/finish-baseline.ts';

void test('no HEAD advance: keep original baseline', () => {
  const r = resolveFinishBaseline({
    baseSha: 'aaaa',
    baselineTreeSha: 'tree-base',
    resultSha: 'aaaa',
    resultTreeSha: 'tree-result',
    headTreeSha: 'tree-result',
  });
  assert.equal(r.baseSha, 'aaaa');
  assert.equal(r.baselineTreeSha, 'tree-base');
  assert.equal(r.rebased, false);
  assert.equal(r.aiCommitSha, null);
});

void test('HEAD advanced, no worktree changes: report against new HEAD', () => {
  const r = resolveFinishBaseline({
    baseSha: 'aaaa',
    baselineTreeSha: 'tree-base',
    resultSha: 'bbbb',           // user pushed an MR
    resultTreeSha: 'tree-base',  // no worktree changes
    headTreeSha: 'tree-base',
  });
  // No rebasing: there's nothing to rebase from. The AI didn't
  // change anything, so we keep the original baseline and mark
  // resultSha as the AI's commit (it's HEAD, but the human pushed
  // it — still acceptable, the server can decide).
  assert.equal(r.baseSha, 'aaaa');
  assert.equal(r.baselineTreeSha, 'tree-base');
  assert.equal(r.rebased, false);
  // aiCommitSha is the result sha (HEAD advanced and not rebased)
  assert.equal(r.aiCommitSha, 'bbbb');
});

void test('HEAD advanced, worktree differs, no explicit AI commit: rebase', () => {
  const r = resolveFinishBaseline({
    baseSha: 'aaaa',
    baselineTreeSha: 'tree-base',
    resultSha: 'bbbb',
    resultTreeSha: 'tree-result-ai',
    headTreeSha: 'tree-head',
  });
  // Rebased: use the new HEAD tree as baseline so we don't
  // double-count the user's MR.
  assert.equal(r.baseSha, 'bbbb');
  assert.equal(r.baselineTreeSha, 'tree-head');
  assert.equal(r.rebased, true);
  assert.equal(r.aiCommitSha, null);
});

void test('explicit AI commit wins: no rebasing', () => {
  const r = resolveFinishBaseline({
    baseSha: 'aaaa',
    baselineTreeSha: 'tree-base',
    resultSha: 'bbbb',
    resultTreeSha: 'tree-result-ai',
    headTreeSha: 'tree-head',
    explicitAiCommitSha: 'cccc',
  });
  assert.equal(r.baseSha, 'aaaa');
  assert.equal(r.baselineTreeSha, 'tree-base');
  assert.equal(r.rebased, false);
  assert.equal(r.aiCommitSha, 'cccc');
});
