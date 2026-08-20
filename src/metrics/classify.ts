/**
 * File classification — production / test / other.
 *
 * Drives both the line_changes filter (protocol 1.4 only sends `production`)
 * and the numstat totals (production + test are reported separately, `other`
 * is silently dropped).
 *
 * Mirrors the same logic in `feature-dev/.workflow/scripts/feature-dev-run-metrics.js`
 * (function `classifyFile`). If you change the rules, update both sides.
 */

import { basename, extname } from 'node:path';

const CODE_EXTENSIONS = new Set<string>([
  '.c', '.cc', '.cpp', '.cs', '.dart', '.ex', '.exs', '.go', '.groovy',
  '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.lua', '.m',
  '.mm', '.php', '.pl', '.pm', '.py', '.rb', '.rs', '.scala', '.sh',
  '.sql', '.swift', '.ts', '.tsx', '.vue',
]);

const CODE_BASENAMES = new Set<string>(['dockerfile', 'makefile', 'rakefile']);

const TEST_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(__tests__|test|tests|spec|specs)(\/|$)/i,
  /\.(test|tests|spec)\.[^.]+$/i,
];

const EXCLUDED_PATH_PATTERNS: RegExp[] = [
  /(^|\/)(dist|build|coverage|generated|target|vendor)(\/|$)/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock)$/i,
  /\.snap$/i,
  /\.min\.(js|css)$/i,
];

export type FileCategory = 'production' | 'test' | 'other';

export function classifyFile(filePath: string): FileCategory {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const base = basename(normalized).toLowerCase();
  const ext = extname(normalized).toLowerCase();
  if (EXCLUDED_PATH_PATTERNS.some((p) => p.test(normalized))) return 'other';
  const isCode = CODE_EXTENSIONS.has(ext) || CODE_BASENAMES.has(base);
  if (!isCode) return 'other';
  if (TEST_PATH_PATTERNS.some((p) => p.test(normalized))) return 'test';
  return 'production';
}
