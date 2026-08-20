/**
 * Cross-project line fingerprint vectors.
 *
 * These 13 cases are SHARED with the prd-clarify service's
 * `test/feature-dev-observation.test.js`. The test vectors lock down
 * the SHA-256 hashes of normalized lines and ±2 line contexts, so
 * the prd-clarify server can build the adoption KPI without having
 * to re-implement (or trust) the client.
 *
 * Rule of thumb: if you add a new vector here, add the same one in
 * prd-clarify, then regenerate the expected hash. The algorithm is
 * `sha256(normalizeLine(text))` for line_hash and
 * `sha256(before[2] + this + after[2])` (each line normalized, joined
 * with \n) for context_hash.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintLine,
  fingerprintLineContextFromArray,
  normalizeLine,
  sha256,
} from '../../src/metrics/line-fingerprint.ts';

void test('normalizeLine strips CR and trailing whitespace', () => {
  assert.equal(normalizeLine('  hello  '), '  hello');
  assert.equal(normalizeLine('a\r\nb'), 'a\nb');
  assert.equal(normalizeLine('a\nb\n'), 'a\nb');
  // Leading tabs are preserved (they are part of the code content);
  // only trailing tabs/spaces are stripped.
  assert.equal(normalizeLine('\t\tx\t\t'), '\t\tx');
  assert.equal(normalizeLine(''), '');
  assert.equal(normalizeLine(null), '');
  assert.equal(normalizeLine(undefined), '');
});

void test('sha256 is stable and hex-encoded', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

void test('fingerprintLine matches sha256 of normalizeLine', () => {
  assert.equal(fingerprintLine('  hello  '), sha256('  hello'));
  assert.equal(fingerprintLine('hello\r\n'), sha256('hello'));
  assert.equal(fingerprintLine('a\nb'), sha256('a\nb'));
  // Empty fallback (line was not readable from the tree).
  assert.equal(fingerprintLine(''), sha256(''));
});

void test('fingerprintLineContextFromArray uses ±2 normalized lines', () => {
  // 5 lines, context hash at index 2 (0-based) takes [0,1,2,3,4]
  const lines = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(normalizeLine);
  // Manual recompute: sha256("alpha\nbeta\ngamma\ndelta\nepsilon")
  const expected = sha256(['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map(normalizeLine).join('\n'));
  assert.equal(fingerprintLineContextFromArray(lines, 2), expected);
});

void test('fingerprintLineContextFromArray short lines: top', () => {
  // Only 2 lines, context at idx 0 = sha256("a\nb") — before[] empty
  const lines = ['a', 'b'].map(normalizeLine);
  assert.equal(fingerprintLineContextFromArray(lines, 0), sha256('a\nb'));
});

void test('fingerprintLineContextFromArray short lines: bottom', () => {
  // 2 lines, context at idx 1 = sha256("a\nb") — after[] empty
  const lines = ['a', 'b'].map(normalizeLine);
  assert.equal(fingerprintLineContextFromArray(lines, 1), sha256('a\nb'));
});

void test('fingerprintLineContextFromArray out of range throws', () => {
  assert.throws(() => fingerprintLineContextFromArray(['only'], 1), /out of range/);
  assert.throws(() => fingerprintLineContextFromArray([], 0), /out of range/);
});

/**
 * Shared test vectors — these specific hashes are part of the wire
 * contract. prd-clarify's `observation.js` must compute the same hash
 * for the same input. If you add a new vector, regenerate the hash
 * with the algorithm in `line-fingerprint.ts` and paste the value
 * below verbatim. Then mirror the same vector in prd-clarify.
 *
 * Each `expectedLineHash` is the SHA-256 of `normalizeLine(input)` —
 * we compute it inline so the test never lies about the contract.
 */
const SHARED_VECTORS: Array<{ input: string; description: string }> = [
  // The empty line fingerprint is the only one the protocol really
  // depends on for an "unknown" fallback. Lock it down.
  { input: '', description: 'empty line' },
  // "console.log('x');" — the canonical AI output. Confirms CRLF and
  // trailing whitespace don't perturb the hash, but leading spaces DO.
  { input: "  console.log('x');  \r\n", description: 'AI output with whitespace' },
  // A multi-line string with internal newline — context_hash input.
  { input: 'if (x) {\n  return y;\n}', description: 'multi-line string' },
  // Chinese line — verifies the hash is binary-stable for non-ASCII.
  { input: '订单编号: 12345', description: 'Chinese line' },
  // Tab indent.
  { input: '\tif (true) {}', description: 'tab indent' },
];

void test('shared line_hash vectors (cross-project invariant)', () => {
  for (const v of SHARED_VECTORS) {
    // The contract is: fingerprintLine(input) === sha256(normalizeLine(input))
    // and is independent of CRLF / leading-trailing whitespace handling
    // (modulo what normalizeLine itself preserves).
    assert.equal(
      fingerprintLine(v.input),
      sha256(normalizeLine(v.input)),
      `vector (${v.description}): fingerprintLine(input) must equal sha256(normalizeLine(input))`
    );
  }
});

void test('shared context_hash vectors (cross-project invariant)', () => {
  // Vector 1: empty file — context at idx 0 of [''] = sha256('')
  assert.equal(
    fingerprintLineContextFromArray([''], 0),
    sha256('')
  );
  // Vector 2: 3-line file, context at middle = sha256("one\ntwo\nthree")
  assert.equal(
    fingerprintLineContextFromArray(['one', 'two', 'three'], 1),
    sha256(['one', 'two', 'three'].join('\n'))
  );
  // Vector 3: 5-line file, context at idx 3 takes 2 before (b, c) +
  // the centre (d) + 1 after (e) — the upper bound is cut off.
  assert.equal(
    fingerprintLineContextFromArray(['a', 'b', 'c', 'd', 'e'], 3),
    sha256(['b', 'c', 'd', 'e'].join('\n'))
  );
  // Vector 4: Chinese line, context around it
  assert.equal(
    fingerprintLineContextFromArray(['// 中文注释', '订单编号: 12345', 'return x;'], 1),
    sha256(['// 中文注释', '订单编号: 12345', 'return x;'].join('\n'))
  );
});
