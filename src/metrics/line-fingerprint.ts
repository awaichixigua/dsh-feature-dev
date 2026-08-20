/**
 * Line fingerprint helpers — protocol 1.2+.
 *
 * Cross-project invariant: this file MUST stay bit-identical to the
 * `lib/feature-dev/observation.js` implementation inside `prd-clarify`. The
 * prd-clarify server uses these hashes to compute code adoption rate; if
 * `line_hash` or `context_hash` drift between client and server, the entire
 * adoption KPI breaks silently.
 *
 * Shared test vectors (13 cases) live in
 * `tests/unit/metrics-line-fingerprint.test.ts`. The same vectors also run
 * inside prd-clarify at `test/feature-dev-observation.test.js`. Both files
 * MUST be kept in lockstep.
 */

import { createHash } from 'node:crypto';

/** Canonicalise one line: drop CR, drop trailing WS, keep internal content. */
export function normalizeLine(line: string | null | undefined): string {
  if (line === null || line === undefined) return '';
  return String(line)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/, '')
    .trimEnd();
}

/** sha256 of a string. Empty string hashes to a known constant. */
export function sha256(text: string): string {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** Fingerprint a single line: hash of its normalised form. */
export function fingerprintLine(line: string | null | undefined): string {
  return sha256(normalizeLine(line));
}

/**
 * Fingerprint a line's local context (1-based lineNo, ±2 surrounding lines).
 * `lines` must already be in the file's own order; the caller is responsible
 * for reading from the right tree (baseline or result) before calling.
 */
export function fingerprintLineContextFromArray(lines: string[], idx: number): string {
  if (!Array.isArray(lines) || idx < 0 || idx >= lines.length) {
    throw new Error(
      `fingerprintLineContextFromArray: idx ${idx} out of range (length ${lines?.length ?? 'n/a'})`
    );
  }
  const before: string[] = [];
  for (let i = Math.max(0, idx - 2); i < idx; i += 1) before.push(lines[i]!);
  const after: string[] = [];
  for (let i = idx + 1; i <= Math.min(lines.length - 1, idx + 2); i += 1) {
    after.push(lines[i]!);
  }
  return sha256([...before, lines[idx]!, ...after].join('\n'));
}
