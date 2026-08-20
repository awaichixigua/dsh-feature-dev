/**
 * Helpers for the `scope` block on the run state and the payload.
 *
 * Three policies that must stay in sync with the original metrics script:
 *
 *   1. `featureId` is matched case-insensitively with non-alphanumerics
 *      stripped, so `F-12`, `F_12`, `F12` all collapse to `f12`.
 *   2. `dependencies` accepts both JSON-array strings and comma-separated
 *      lists; duplicate / blank entries are dropped and the result is
 *      sorted so two clients send the same payload for the same input.
 *   3. `runType` is always one of the two protocol-defined values.
 */

import type { RunScope, RunType } from './types.js';

export function normalizeOptional(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  if (!text || text === '—' || (text.startsWith('{') && text.endsWith('}'))) return null;
  return text;
}

export function normalizeFeatureSuffix(
  featureId: string | null | undefined,
  value: string | null | undefined
): string | null {
  const explicit = normalizeOptional(value ?? null);
  if (explicit) return explicit.toLowerCase().replace(/[-_]/g, '');
  return featureId ? featureId.toLowerCase().replace(/[-_]/g, '') : null;
}

export function parseDependencies(value: string | string[] | null | undefined): string[] {
  const text = normalizeOptional(typeof value === 'string' ? value : value?.join(',') ?? null);
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('feature dependencies must be an array');
    return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))].sort();
  }
  return [
    ...new Set(
      text
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ].sort();
}

export function normalizeRunType(value: string | null | undefined): RunType {
  const candidate = normalizeOptional(value) ?? 'code_gen';
  if (candidate !== 'code_gen' && candidate !== 'bugfix') {
    throw new Error('run type must be code_gen or bugfix');
  }
  return candidate;
}

export function scopeDetails(args: {
  featureId: string | null | undefined;
  featureSuffix?: string | null;
  featureDependencies?: string | string[] | null;
}): RunScope {
  const featureId = normalizeOptional(args.featureId ?? null);
  return {
    type: featureId ? 'feature' : 'full',
    target_feature_id: featureId,
    target_feature_suffix: normalizeFeatureSuffix(featureId, args.featureSuffix ?? null),
    target_feature_dependencies: parseDependencies(args.featureDependencies ?? null),
  };
}

/**
 * Derive a numeric requirement id from the current branch name. Branch
 * naming convention is "<something>/<reqId>-<description>" (e.g. feat/1234-foo).
 * The first 4+ digit number wins; if more than one is present, the rule
 * fails loud instead of silently picking a wrong one.
 */
export function requirementIdFromBranch(branch: string): string {
  const pattern = /(?:^|[/_#-])(\d{4,})(?=$|[-_/])/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(branch)) !== null) matches.push(m[1]!);
  const unique = [...new Set(matches)];
  if (unique.length === 0) {
    throw new Error('Git branch does not contain a requirement id');
  }
  if (unique.length > 1) {
    throw new Error('Git branch contains multiple requirement ids');
  }
  return unique[0]!;
}
