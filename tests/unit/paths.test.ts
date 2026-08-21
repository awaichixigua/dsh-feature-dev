/**
 * Unit tests for path helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  resolveMrdStagingDir,
  resolvePackageRoot,
  resolveProjectRoot,
  validateFeatureDir,
  isInside,
  resolveResourceBase,
  hasProjectMarker,
} from '../../src/runtime/paths.ts';

function makeProjectWithGit(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-paths-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}

void test('resolveProjectRoot: explicit absolute path wins', () => {
  const dir = makeProjectWithGit();
  try {
    const r = resolveProjectRoot({ explicit: dir, cwd: '/' });
    assert.equal(r, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolveProjectRoot: rejects relative explicit', () => {
  assert.throws(() => resolveProjectRoot({ explicit: 'relative/path' }));
});

void test('resolveProjectRoot: falls back to cwd when no git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-paths2-'));
  try {
    const r = resolveProjectRoot({ cwd: dir });
    assert.equal(r, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolveProjectRoot: nearest git toplevel', () => {
  const root = makeProjectWithGit();
  try {
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const r = resolveProjectRoot({ cwd: sub });
    assert.equal(r, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('validateFeatureDir: rejects escape', () => {
  const dir = makeProjectWithGit();
  try {
    assert.throws(() => validateFeatureDir('C:\\Windows', dir), /outside projectRoot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('validateFeatureDir: rejects banned components', () => {
  const dir = makeProjectWithGit();
  try {
    const banned = join(dir, 'node_modules', 'foo');
    assert.throws(() => validateFeatureDir(banned, dir), /banned path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('isInside: returns true for child', () => {
  assert.ok(isInside('/a/b/c', '/a'));
  assert.ok(!isInside('/a/b', '/a/c'));
  assert.ok(isInside('/a', '/a'));
});

void test('resolveResourceBase: requires inside packageRoot', () => {
  // /b is absolute; we want either "must not be absolute" OR "escaped" —
  // both are valid rejections. We accept either.
  assert.throws(
    () => resolveResourceBase('/a', '/b'),
    /must not be absolute|escaped/
  );
});

void test('hasProjectMarker: detects .git', () => {
  const dir = makeProjectWithGit();
  try {
    assert.ok(hasProjectMarker(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('hasProjectMarker: detects package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-paths3-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{}');
    assert.ok(hasProjectMarker(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolvePackageRoot: finds the one with package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fd-paths4-'));
  try {
    const sub = join(dir, 'a', 'b', 'c');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    const fakeUrl = 'file:///' + resolve(sub).replace(/\\/g, '/') + '/foo.js';
    const r = resolvePackageRoot(fakeUrl);
    assert.equal(r, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('resolveMrdStagingDir: uses a stable URL fingerprint below project .tmp', () => {
  const root = process.platform === 'win32' ? 'D:\\work\\aggregate' : '/work/aggregate';
  const a = resolveMrdStagingDir(root, 'https://example.com/share_doc/?token=one');
  const b = resolveMrdStagingDir(root, 'https://example.com/share_doc/?token=one');
  const c = resolveMrdStagingDir(root, 'https://example.com/share_doc/?token=two');
  assert.equal(a, b);
  assert.match(a.replace(/\\/g, '/'), /\/\.tmp\/mrdoc-[a-f0-9]{12}$/);
  assert.notEqual(a, c);
});

void test('resolveMrdStagingDir: feature identity replaces the legacy URL hash', () => {
  const root = process.platform === 'win32' ? 'D:\\work\\aggregate' : '/work/aggregate';
  const name = '2.0.0_103111_fastjson替换为jackson';
  const a = resolveMrdStagingDir(root, 'https://example.com/share_doc/?token=one', name);
  const b = resolveMrdStagingDir(root, 'https://example.com/share_doc/?token=two', name);
  assert.equal(a, join(root, '.tmp', name));
  assert.equal(a, b);
});
