/**
 * Diff parser — extract per-line `line_changes` (protocol 1.2+) and
 * aggregate `metrics` (numstat).
 *
 * Two functions, both with a single argument pair: projectRoot + two
 * tree SHAs (baseline and result). They are read-only — they do not
 * touch the worktree or the index.
 *
 * Protocol 1.4 behaviour: `calculateLineChanges` skips non-production rows
 * BEFORE counting, so a 50k-line test rebase does not blow the 5000 cap
 * and downgrade the report. Protocol 1.1 fallback (no line_changes at all)
 * is triggered by the caller when this function throws.
 *
 * `-c core.quotePath=false` is critical: without it git turns non-ASCII
 * paths into `\xxx\yyy` octal escapes, which the prd-clarify server cannot
 * match against its own numstat rows.
 */

import { runGit } from './git.js';
import { classifyFile } from './classify.js';
import {
  fingerprintLine,
  fingerprintLineContextFromArray,
  normalizeLine,
} from './line-fingerprint.js';
import {
  MAX_LINE_CHANGES_PER_RUN,
  type LineChangeEntry,
  type RunMetricsTotals,
} from './types.js';

const HUNK_HEADER_REGEX = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

export interface ParsedFile {
  path: string | null;
  old_path: string | null;
  hunks: ParsedHunk[];
}

export interface ParsedHunk {
  hunk_index: number;
  old_start: number;
  new_start: number;
  lines: ParsedHunkLine[];
}

export interface ParsedHunkLine {
  change_type: 'added' | 'removed' | 'context';
  line: string;
  old_line_no: number | null;
  new_line_no: number | null;
}

export function parseHunks(diffOutput: string): ParsedFile[] {
  const lines = String(diffOutput || '').split('\n');
  const files: ParsedFile[] = [];
  let currentFile: ParsedFile | null = null;
  let currentHunk: ParsedHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      if (currentFile) files.push(currentFile);
      currentFile = { path: null, old_path: null, hunks: [] };
      currentHunk = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!currentFile) continue;
      currentFile.old_path = line.slice(4).replace(/^a\//, '').trim();
      if (currentFile.old_path === '/dev/null') currentFile.old_path = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!currentFile) continue;
      const newPath = line.slice(4).replace(/^b\//, '').trim();
      currentFile.path = newPath === '/dev/null' ? null : newPath;
      continue;
    }
    const hunkMatch = line.match(HUNK_HEADER_REGEX);
    if (hunkMatch) {
      if (!currentFile) continue;
      oldLineNo = Number(hunkMatch[1]);
      newLineNo = Number(hunkMatch[3]);
      currentHunk = {
        hunk_index: currentFile.hunks.length,
        old_start: oldLineNo,
        new_start: newLineNo,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk === null) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({
        change_type: 'added',
        line: line.slice(1),
        old_line_no: null,
        new_line_no: newLineNo,
      });
      newLineNo += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({
        change_type: 'removed',
        line: line.slice(1),
        old_line_no: oldLineNo,
        new_line_no: null,
      });
      oldLineNo += 1;
    } else if (line.startsWith(' ')) {
      oldLineNo += 1;
      newLineNo += 1;
    } else if (line === '\\ No newline at end of file') {
      // ignored
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

function countRemovedBefore(hunkLines: ParsedHunkLine[], idx: number): number {
  let n = 0;
  for (let i = 0; i < idx; i += 1) if (hunkLines[i]!.change_type === 'removed') n += 1;
  return n;
}

function countAddedBefore(hunkLines: ParsedHunkLine[], idx: number): number {
  let n = 0;
  for (let i = 0; i < idx; i += 1) if (hunkLines[i]!.change_type === 'added') n += 1;
  return n;
}

export function calculateLineChanges(
  projectRoot: string,
  baselineTree: string,
  resultTree: string
): LineChangeEntry[] {
  const output = runGit(
    [
      '-c', 'core.quotePath=false',
      'diff', '-U3', '-M', '--find-renames=50%',
      baselineTree, resultTree, '--',
    ],
    { cwd: projectRoot }
  );
  const files = parseHunks(output);
  const lineChanges: LineChangeEntry[] = [];
  let counter = 0;

  // Cache normalised lines per (tree, path) so we don't `git show` twice
  // for the same file across hunks.
  const fileCache = new Map<string, string[] | null>();
  function getFileLines(tree: string, filePath: string | null): string[] | null {
    if (!filePath) return null;
    const key = `${tree}:${filePath}`;
    if (fileCache.has(key)) return fileCache.get(key) ?? null;
    const buf = runGit(['show', `${tree}:${filePath}`], { cwd: projectRoot });
    if (buf === '' || buf === null) {
      fileCache.set(key, null);
      return null;
    }
    const lines = buf.split('\n').map(normalizeLine);
    fileCache.set(key, lines);
    return lines;
  }

  for (const file of files) {
    const effectivePath = file.path || file.old_path;
    if (!effectivePath) continue;
    // Protocol 1.4: skip non-production BEFORE reading the file. This
    // keeps test/config diffs from blowing the 5000 cap.
    if (classifyFile(effectivePath) !== 'production') continue;
    const baselineLines = getFileLines(baselineTree, file.old_path || file.path);
    const resultLines = getFileLines(resultTree, file.path);

    for (const hunk of file.hunks) {
      for (let li = 0; li < hunk.lines.length; li += 1) {
        const l = hunk.lines[li]!;
        if (l.change_type !== 'added' && l.change_type !== 'removed') continue;

        let ctxHash: string;
        if (l.change_type === 'added' && resultLines && l.new_line_no !== null) {
          ctxHash = fingerprintLineContextFromArray(resultLines, l.new_line_no - 1);
        } else if (l.change_type === 'removed' && baselineLines && l.old_line_no !== null) {
          ctxHash = fingerprintLineContextFromArray(baselineLines, l.old_line_no - 1);
        } else {
          ctxHash = fingerprintLine('');
        }

        const lineIndex =
          l.change_type === 'added'
            ? li - countRemovedBefore(hunk.lines, li)
            : li - countAddedBefore(hunk.lines, li);

        lineChanges.push({
          path: effectivePath,
          old_path: file.old_path,
          hunk_index: hunk.hunk_index,
          line_index: lineIndex,
          change_type: l.change_type,
          old_line_no: l.old_line_no,
          new_line_no: l.new_line_no,
          line_hash: fingerprintLine(l.line),
          context_hash: ctxHash,
          category: 'production',
        });
        counter += 1;
        if (counter > MAX_LINE_CHANGES_PER_RUN) {
          throw new Error(`line_changes exceeds ${MAX_LINE_CHANGES_PER_RUN} entries`);
        }
      }
    }
  }
  return lineChanges;
}

interface NumstatRow {
  added: number;
  deleted: number;
  path: string;
}

function parseNumstat(output: string): NumstatRow[] {
  const items = String(output || '').split('\0');
  const changes: NumstatRow[] = [];
  let index = 0;
  while (index < items.length) {
    const header = items[index++];
    if (!header) continue;
    const fields = header.split('\t');
    if (fields.length < 3) continue;
    const added = Number(fields[0]);
    const deleted = Number(fields[1]);
    let filePath = fields.slice(2).join('\t');
    if (!filePath) {
      index += 1;
      filePath = items[index++] || '';
    }
    if (!Number.isFinite(added) || !Number.isFinite(deleted) || !filePath) continue;
    changes.push({ added, deleted, path: filePath });
  }
  return changes;
}

export function calculateMetrics(
  projectRoot: string,
  baselineTree: string,
  resultTree: string
): RunMetricsTotals {
  const output = runGit(
    ['diff', '--numstat', '-z', '--find-renames', baselineTree, resultTree, '--'],
    { cwd: projectRoot }
  );
  const totals: RunMetricsTotals = {
    ai_production_added_lines: 0,
    ai_production_deleted_lines: 0,
    ai_test_added_lines: 0,
    ai_test_deleted_lines: 0,
  };
  for (const change of parseNumstat(output)) {
    const cat = classifyFile(change.path);
    if (cat === 'production') {
      totals.ai_production_added_lines += change.added;
      totals.ai_production_deleted_lines += change.deleted;
    } else if (cat === 'test') {
      totals.ai_test_added_lines += change.added;
      totals.ai_test_deleted_lines += change.deleted;
    }
  }
  return totals;
}
