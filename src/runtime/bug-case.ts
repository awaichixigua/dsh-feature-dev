/**
 * Bugfix case-directory ownership.
 *
 * A bugfix must own one numbered directory under `featureDir/bugfix/` before
 * LOCATE starts. This keeps report paths deterministic without making a
 * missing directory a human-action blocker.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ValidationError } from './errors.js';

export interface BugCase {
  bugCaseDir: string;
  bugCaseId: string;
}

export function ensureBugCase(args: {
  featureDir: string;
  bugDescription: string;
  bugCaseId?: string;
}): BugCase {
  const root = resolve(args.featureDir, 'bugfix');
  mkdirSync(root, { recursive: true });
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const requestedId = args.bugCaseId?.trim();
  if (requestedId && !/^\d+$/.test(requestedId)) {
    throw new ValidationError('bugCaseId 必须是纯数字编号', { bugCaseId: args.bugCaseId });
  }
  const reusable = requestedId ? [] : entries.filter((name) => {
    const dir = join(root, name);
    return !existsSync(join(dir, 'bug-report.md')) && !existsSync(join(dir, 'bugfix-report.md'));
  });
  const reusedDirectory = reusable.length === 1 ? reusable[0] : undefined;
  const bugCaseId = requestedId
    ?? reusedDirectory?.match(/^(\d+)(?:-|$)/)?.[1]
    ?? String(nextNumericId(entries));
  const matching = entries.filter((name) => new RegExp(`^${escapeRegExp(bugCaseId)}(?:-|$)`).test(name));
  if (matching.length > 1) {
    throw new ValidationError(`缺陷编号 ${bugCaseId} 对应多个目录`, { bugCaseId, matching });
  }
  const directoryName = matching[0] ?? reusedDirectory ?? `${bugCaseId}-${toChineseSlug(args.bugDescription)}`;
  const absoluteDir = join(root, directoryName);
  mkdirSync(absoluteDir, { recursive: true });

  const bugReport = join(absoluteDir, 'bug-report.md');
  if (!existsSync(bugReport)) {
    writeFileSync(bugReport, [
      `# 缺陷 ${bugCaseId}`,
      '',
      '## 原始描述',
      '',
      args.bugDescription.trim(),
      '',
    ].join('\n'), 'utf8');
  }
  return { bugCaseDir: `bugfix/${directoryName}`, bugCaseId };
}

function nextNumericId(entries: string[]): number {
  const ids = entries
    .map((entry) => /^(\d+)(?:-|$)/.exec(entry)?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number);
  return (ids.length === 0 ? 0 : Math.max(...ids)) + 1;
}

function toChineseSlug(description: string): string {
  const firstLine = description.split(/\r?\n/, 1)[0] ?? '';
  const compact = firstLine
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, '')
    .slice(0, 32);
  return /[\u3400-\u9fff]/.test(compact) ? compact : '缺陷修复';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
