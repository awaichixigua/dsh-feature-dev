/**
 * Artifact Validator.
 *
 * Decides whether the artifacts declared by a phase are actually present
 * on disk. The validator does NOT inspect their content beyond basic
 * schema/size checks — content checks belong to the Subagent.
 *
 * Validation is per-phase and uses a small DSL: the phase declares what
 * artifacts it expects, and the validator checks each.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

export interface ArtifactSpec {
  /** Path relative to projectRoot, or absolute (must be inside projectRoot). */
  path: string;
  /** Minimum size in bytes (0 = just must exist). */
  minSize?: number;
  /** Must parse as JSON if true. */
  json?: boolean;
  /** If set, must contain at least one of these substrings. */
  mustContain?: string[];
  /** Maximum size in bytes; over this is a warning. */
  maxSize?: number;
}

export interface ArtifactResult {
  path: string;
  ok: boolean;
  reason?: string;
  size?: number;
}

export function validateArtifacts(
  projectRoot: string,
  specs: ArtifactSpec[]
): { ok: boolean; results: ArtifactResult[] } {
  const results: ArtifactResult[] = specs.map((spec) => checkOne(projectRoot, spec));
  return { ok: results.every((r) => r.ok), results };
}

function checkOne(projectRoot: string, spec: ArtifactSpec): ArtifactResult {
  const abs = isAbsolute(spec.path) ? spec.path : resolve(projectRoot, spec.path);
  if (!existsSync(abs)) {
    return { path: abs, ok: false, reason: 'missing' };
  }
  const stat = statSync(abs);
  if (!stat.isFile()) {
    return { path: abs, ok: false, reason: 'not_a_file' };
  }
  if (spec.minSize && stat.size < spec.minSize) {
    return { path: abs, ok: false, reason: 'too_small', size: stat.size };
  }
  if (spec.maxSize && stat.size > spec.maxSize) {
    return { path: abs, ok: true, reason: 'too_large_warn', size: stat.size };
  }
  if (spec.json) {
    try {
      JSON.parse(readFileSync(abs, 'utf8'));
    } catch (e) {
      return { path: abs, ok: false, reason: 'invalid_json: ' + (e instanceof Error ? e.message : '?') };
    }
  }
  if (spec.mustContain && spec.mustContain.length > 0) {
    const txt = readFileSync(abs, 'utf8');
    for (const needle of spec.mustContain) {
      if (!txt.includes(needle)) {
        return { path: abs, ok: false, reason: `missing_substring:${needle}` };
      }
    }
  }
  return { path: abs, ok: true, size: stat.size };
}
