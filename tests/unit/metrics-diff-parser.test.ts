/**
 * Unit tests for `parseHunks` and friends.
 *
 * The parser is pure (string in, structure out) so it doesn't need
 * a git repo. We feed it canned `git diff -U3` output and verify
 * the line structure, hunk indexing, and 1-based line numbers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHunks } from '../../src/metrics/diff-parser.ts';

void test('parseHunks: single added file', () => {
  const diff = [
    'diff --git a/new.ts b/new.ts',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/new.ts',
    '@@ -0,0 +1,3 @@',
    '+line one',
    '+line two',
    '+line three',
  ].join('\n');
  const files = parseHunks(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.old_path, null);
  assert.equal(files[0]!.path, 'new.ts');
  assert.equal(files[0]!.hunks.length, 1);
  const lines = files[0]!.hunks[0]!.lines;
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => [l.change_type, l.new_line_no, l.line]),
    [
      ['added', 1, 'line one'],
      ['added', 2, 'line two'],
      ['added', 3, 'line three'],
    ]
  );
});

void test('parseHunks: single deleted file', () => {
  const diff = [
    'diff --git a/old.ts b/old.ts',
    'deleted file mode 100644',
    'index 2222222..0000000',
    '--- a/old.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-goodbye',
    '-world',
  ].join('\n');
  const files = parseHunks(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.old_path, 'old.ts');
  assert.equal(files[0]!.path, null);
  const lines = files[0]!.hunks[0]!.lines;
  assert.deepEqual(
    lines.map((l) => [l.change_type, l.old_line_no, l.line]),
    [
      ['removed', 1, 'goodbye'],
      ['removed', 2, 'world'],
    ]
  );
});

void test('parseHunks: modified file with context', () => {
  // Walk-through of the parser's line-number counter:
  //   hunk header sets oldLineNo=10, newLineNo=10
  //   " context before"  -> old=10, new=10  (context row: not pushed, both counters ++)
  //   "-removed line"    -> old=11           (pushed as removed, oldLineNo++)
  //   "+added line A"    -> new=11           (pushed as added, newLineNo++)
  //   "+added line B"    -> new=12           (pushed as added, newLineNo++)
  //   " context after"   -> old=12, new=13   (not pushed)
  const diff = [
    'diff --git a/m.ts b/m.ts',
    'index 1111111..2222222 100644',
    '--- a/m.ts',
    '+++ b/m.ts',
    '@@ -10,4 +10,5 @@',
    ' context before',
    '-removed line',
    '+added line A',
    '+added line B',
    ' context after',
  ].join('\n');
  const files = parseHunks(diff);
  assert.equal(files.length, 1);
  const hunk = files[0]!.hunks[0]!;
  // Only +/- lines are kept (context lines are not part of line_changes).
  assert.equal(hunk.lines.length, 3);
  assert.equal(hunk.lines[0]!.change_type, 'removed');
  assert.equal(hunk.lines[0]!.old_line_no, 11);
  assert.equal(hunk.lines[1]!.change_type, 'added');
  assert.equal(hunk.lines[1]!.new_line_no, 11);
  assert.equal(hunk.lines[1]!.line, 'added line A');
  assert.equal(hunk.lines[2]!.change_type, 'added');
  assert.equal(hunk.lines[2]!.new_line_no, 12);
  assert.equal(hunk.lines[2]!.line, 'added line B');
});

void test('parseHunks: hunk_index increments within a file', () => {
  const diff = [
    'diff --git a/m.ts b/m.ts',
    '--- a/m.ts',
    '+++ b/m.ts',
    '@@ -1,1 +1,1 @@',
    '-a',
    '+A',
    '@@ -50,1 +50,1 @@',
    '-b',
    '+B',
  ].join('\n');
  const files = parseHunks(diff);
  assert.equal(files[0]!.hunks.length, 2);
  assert.equal(files[0]!.hunks[0]!.hunk_index, 0);
  assert.equal(files[0]!.hunks[1]!.hunk_index, 1);
});

void test('parseHunks: multiple files, mixed', () => {
  const diff = [
    'diff --git a/one.ts b/one.ts',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1,1 +1,1 @@',
    '-x',
    '+X',
    'diff --git a/two.ts b/two.ts',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -1,1 +1,1 @@',
    '-y',
    '+Y',
  ].join('\n');
  const files = parseHunks(diff);
  assert.equal(files.length, 2);
  assert.equal(files[0]!.path, 'one.ts');
  assert.equal(files[1]!.path, 'two.ts');
});

void test('parseHunks: empty input is empty list', () => {
  assert.deepEqual(parseHunks(''), []);
});
