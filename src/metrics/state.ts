/**
 * Metrics state and queue IO.
 *
 * Layout (default `~/.feature-dev/metrics/`):
 *   runs/<sha256>.json                — one per active run
 *   queue/pending/<run_id>.json       — envelopes awaiting delivery
 *   queue/failed/<run_id>.json        — envelopes that exhausted retries
 *   bugfix-allocations/<featureKey>/  — bugfix binding reservation lock
 *
 * All writes are atomic (write tmp + rename) so a crash never leaves a
 * half-written state file. The `enqueuePending` helper is the only
 * place that decides "this run goes to queue/pending", and it does so
 * by `run_id` (not by content hash) so a re-finish on the same run
 * overwrites the previous envelope in place.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_METRICS_HOME = join(homedir(), '.feature-dev', 'metrics');

export function metricsHome(explicit?: string | null): string {
  const value = explicit ?? process.env.FEATURE_DEV_METRICS_HOME ?? DEFAULT_METRICS_HOME;
  return value;
}

function ensureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function ensureMetricsLayout(home: string): void {
  ensureDirectory(home);
  ensureDirectory(join(home, 'runs'));
  ensureDirectory(join(home, 'queue', 'pending'));
  ensureDirectory(join(home, 'queue', 'failed'));
  ensureDirectory(join(home, 'bugfix-allocations'));
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function readJsonOptional<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function atomicWriteJson(file: string, value: unknown): void {
  ensureDirectory(join(file, '..'));
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  // On Windows, rename can fail if the destination is held by a virus scanner
  // or a process-mapped file. Retry once after unlinking the destination.
  try {
    renameSync(tmp, file);
  } catch {
    try { rmSync(file, { force: true }); } catch { /* ignore */ }
    renameSync(tmp, file);
  }
}

export function queuePaths(home: string): { pending: string; failed: string } {
  return {
    pending: join(home, 'queue', 'pending'),
    failed: join(home, 'queue', 'failed'),
  };
}

export function queueFileFor(home: string, runId: string): string {
  return join(queuePaths(home).pending, `${runId}.json`);
}

export function failedFileFor(home: string, runId: string): string {
  return join(queuePaths(home).failed, `${runId}.json`);
}

/**
 * Identity hash for a run — same algorithm as the original metrics script
 * so the run state file location is stable across the two clients (DSH and
 * the original feature-dev Claude plugin). This matters when both clients
 * ever run on the same machine: the second one to start picks up the
 * first one's in_progress state instead of starting a fresh run.
 *
 * NOTE: `runType` and (for bugfix) `bugId`/`bindingId` are part of the
 * identity. The original script keys bugfix state by `(runType, bugId)`
 * and by `bindingId` when present, so a code_gen run and a bugfix run
 * for the same feature can never reuse each other's state file. We
 * follow the same rule here to avoid a `pending` code_gen run being
 * mistaken for a resumed bugfix run (or vice versa).
 */
export function stateIdentity(
  projectRoot: string,
  featureDir: string,
  scope: { type: string; target_feature_id: string | null },
  runType: 'code_gen' | 'bugfix' = 'code_gen',
  bugId: string | null = null,
  bindingId: string | null = null
): string {
  const parts: string[] = [projectRoot, featureDir, scope.type, scope.target_feature_id || 'full', runType];
  if (runType === 'bugfix') {
    parts.push(bugId || 'no-bug-id');
    if (bindingId) parts.push('binding', bindingId);
  }
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function runStatePath(
  home: string,
  args: {
    projectRoot: string;
    featureDir: string;
    scope: { type: string; target_feature_id: string | null };
    runType?: 'code_gen' | 'bugfix';
    bugId?: string | null;
    bindingId?: string | null;
  }
): string {
  return join(
    home,
    'runs',
    `${stateIdentity(
      args.projectRoot,
      args.featureDir,
      args.scope,
      args.runType ?? 'code_gen',
      args.bugId ?? null,
      args.bindingId ?? null
    )}.json`
  );
}

/** SHA-256 fingerprint of a file's contents; null if file does not exist. */
export function fileFingerprint(file: string | null): string | null {
  if (!file || !existsSync(file)) return null;
  const content = readFileSync(file);
  return createHash('sha256').update(content).digest('hex');
}

/** Lightweight Markdown writer — only updates the `metrics_*` rows. */
export function updateExecutionStateMetrics(
  file: string | null,
  fields: Record<string, string | number | null>
): void {
  if (!file || !existsSync(file)) return;
  let content = readFileSync(file, 'utf8');
  const missing: string[] = [];
  for (const [key, rawValue] of Object.entries(fields)) {
    const value = cleanMarkdownValue(rawValue);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `^(\\|\\s*${escapedKey}\\s*\\|\\s*)(.*?)(\\s*\\|)\\s*$`,
      'm'
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, (_full, prefix: string, _old: string, suffix: string) =>
        `${prefix}${value}${suffix}`
      );
    } else {
      missing.push(`| ${key} | ${value} |`);
    }
  }
  if (missing.length > 0) {
    const section = content.indexOf('## 过程数据');
    if (section >= 0) {
      const boundaryCandidates = [
        content.indexOf('\n---', section + 1),
        content.indexOf('\n## ', section + 1),
      ].filter((i) => i >= 0);
      const boundary = boundaryCandidates.length > 0 ? Math.min(...boundaryCandidates) : content.length;
      content = `${content.slice(0, boundary).trimEnd()}\n${missing.join('\n')}\n${content.slice(boundary)}`;
    }
  }
  writeFileSync(file, content, 'utf8');
}

function cleanMarkdownValue(value: string | number | null | undefined): string {
  return String(value ?? '—').replace(/[|\r\n]+/g, ' ').trim() || '—';
}
