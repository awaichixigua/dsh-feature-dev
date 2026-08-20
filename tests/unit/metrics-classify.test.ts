/**
 * Unit tests for `classifyFile` (production / test / other).
 *
 * Mirrors the same heuristic in
 * `feature-dev/.workflow/scripts/feature-dev-run-metrics.js`. The
 * classification drives the line_changes filter (protocol 1.4 only
 * ships `production`) and the numstat totals, so a regression here
 * would change every adoption-KPI the server computes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile } from '../../src/metrics/classify.ts';

void test('classifyFile recognises CODE_EXTENSIONS as production', () => {
  for (const path of [
    'src/foo.ts',
    'src/bar.tsx',
    'lib/baz.py',
    'main.go',
    'src/Component.jsx',
    'pkg/handler.php',
    'script.sh',
    'src/Main.java',
    'src/foo.cc',
  ]) {
    assert.equal(classifyFile(path), 'production', path);
  }
});

void test('classifyFile recognises CODE_BASENAMES as production', () => {
  for (const path of ['Dockerfile', 'Makefile', 'rakefile', 'docker/Dockerfile']) {
    assert.equal(classifyFile(path), 'production', path);
  }
});

void test('classifyFile recognises TEST_PATH_PATTERNS as test', () => {
  for (const path of [
    'tests/foo.test.ts',
    'src/__tests__/foo.ts',
    'spec/foo.spec.js',
    'test/bar.py',
    'lib/tests/baz.js',
    'src/foo.spec.ts',
    'src/foo.tests.ts',
  ]) {
    assert.equal(classifyFile(path), 'test', path);
  }
});

void test('classifyFile drops EXCLUDED_PATH_PATTERNS as other', () => {
  for (const path of [
    'dist/bundle.js',
    'build/output.js',
    'coverage/lcov.info',
    'generated/foo.ts',
    'target/release/main',
    'vendor/lib/foo.js',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'composer.lock',
    'poetry.lock',
    'src/__snapshots__/foo.snap',
    'public/main.min.js',
    'public/main.min.css',
  ]) {
    assert.equal(classifyFile(path), 'other', path);
  }
});

void test('classifyFile returns other for unknown extensions', () => {
  for (const path of ['README.md', 'docs/foo.txt', 'data.json', 'logo.png']) {
    assert.equal(classifyFile(path), 'other', path);
  }
});

void test('classifyFile accepts backslash paths (Windows)', () => {
  assert.equal(classifyFile('src\\foo.ts'), 'production');
  assert.equal(classifyFile('tests\\foo.test.ts'), 'test');
  assert.equal(classifyFile('dist\\bundle.js'), 'other');
});
