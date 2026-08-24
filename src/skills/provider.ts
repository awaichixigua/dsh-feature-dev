/**
 * Skill Provider.
 *
 * Discovers `skills/<name>/SKILL.md`, validates each one, and exposes
 * them as a single Dsh SkillProvider registered with
 * `ctx.skills.registerProvider(create)`. The create factory is the
 * shape DSH requires — synchronous, returning a `SkillProvider` whose
 * `list` and `get` are async and return `SkillCandidate` /
 * `SkillDefinition` values.
 *
 * The provider is purely declarative: it does not implement `invoke`.
 * DSH's runtime reads `SkillDefinition.content` and injects it as
 * model-facing `<skill_content>`; the model then decides when to call
 * the `feature_dev_run` tool, exactly as the DSH spec says.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ForbiddenError, ValidationError } from '../runtime/errors.js';
import { KNOWN_WORKFLOWS, type NormalizeInput } from '../runtime/invocation.js';
import type { WorkflowId } from '../types/contracts.js';
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillSource,
} from '../dsh/sdk.js';
import { BUNDLED_SKILL_RANK } from '../dsh/sdk.js';

/** Discovery result before SKILL.md is parsed. */
export interface SkillDescriptor {
  name: string;
  description: string;
  userInvocable: boolean;
  modelInvocable: boolean;
  resourceBase: string;
  body: string;
  argumentHint?: string;
}

const FORBIDDEN = ['$ARGUMENTS', 'CLAUDE_PLUGIN_ROOT', '/feature-dev:'];
function assertSkillClean(skill: SkillDescriptor) {
  for (const p of FORBIDDEN) {
    if (skill.body.includes(p) || skill.description.includes(p)) {
      throw new ForbiddenError(`Skill ${skill.name} contains forbidden token: ${p}`);
    }
  }
}

export function discoverSkills(packageRoot: string): SkillDescriptor[] {
  const skillsDir = resolve(packageRoot, 'skills');
  if (!existsSync(skillsDir)) return [];
  const out: SkillDescriptor[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(skillsDir, entry.name);
    const file = resolve(dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const desc = parseSkillFile(raw, entry.name, dir);
    assertSkillClean(desc);
    out.push(desc);
  }
  return out;
}

function parseSkillFile(raw: string, fallbackName: string, resourceBase: string): SkillDescriptor {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) {
    throw new ValidationError('SKILL.md missing YAML frontmatter', { resourceBase });
  }
  const front = m[1]!;
  const body = m[2]!.trim();
  const meta: Record<string, string> = {};
  for (const line of front.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    meta[k] = v;
  }
  return {
    name: meta.name ?? fallbackName,
    description: meta.description ?? '',
    userInvocable: meta['user-invocable'] !== 'false',
    modelInvocable: meta['disable-model-invocation'] !== 'true',
    argumentHint: meta['argument-hint'],
    body,
    resourceBase,
  };
}

function existsSync(p: string): boolean {
  try {
    return statSync(p).isFile() || statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Backwards-compatible alias for the old `parseToolArgv(argv, defaultWorkflow)`
 * shape. Skills in the original Claude plugin called tools with
 * `parseToolArgv('--feature-dir req/x', 'code-gen-tdd')`. The new
 * `parseSkillArgv` only takes argv and uses heuristics to determine the
 * workflow; this wrapper restores the explicit `defaultWorkflow` fallback.
 *
 * Semantics:
 *   - Empty argv (or only whitespace) -> { workflow: defaultWorkflow }
 *   - argv is a URL or .md file        -> { workflow: 'implementation-plan', mrdUrl }
 *   - argv is a known workflow         -> that workflow wins
 *   - otherwise                        -> fall back to defaultWorkflow
 *
 * We pre-seed `workflow` with the default BEFORE calling the token parser,
 * so the parser only OVERRIDES the default if argv explicitly says so.
 */
export function parseToolArgv(argv: string, defaultWorkflow: WorkflowId): NormalizeInput {
  const trimmed = argv.trim();
  if (trimmed.length === 0) {
    return { workflow: defaultWorkflow };
  }
  // Pre-seed workflow so the inner parser only overrides on a clear hint.
  const seeded: NormalizeInput = { workflow: defaultWorkflow };
  const tokens = rawTokenize(trimmed);
  applyTokens(seeded, tokens);
  return seeded;
}

// ---- internals: a fork of parseSkillArgv that does NOT infer workflow ---
//
// We don't want the URL / .md / positional-as-bug heuristics from
// parseSkillArgv. parseToolArgv's caller has a default; it only needs
// to PICK UP overrides from argv.

const VALUE_FLAGS = new Set(['project-root', 'feature-dir', 'feature-id', 'target', 'mrd-url', 'clarify-mode', 'bug']);

function rawTokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') { inDouble = !inDouble; continue; }
    if (!inDouble && (ch === ' ' || ch === '\t')) {
      if (cur.length > 0) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function applyTokens(out: NormalizeInput, tokens: readonly string[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('--')) {
      // First non-flag token: only override workflow if it's a known
      // workflow name. Otherwise leave the default in place.
      if (KNOWN_WORKFLOWS.has(t.toLowerCase() as WorkflowId)) {
        out.workflow = t.toLowerCase() as WorkflowId;
      } else if (/^https?:\/\//.test(t) || t.includes('share_doc') || t.endsWith('.md')) {
        out.mrdUrl = t;
        out.workflow = 'implementation-plan';
      } else if (out.workflow === 'implementation-plan' || out.workflow === 'mrd-to-code') {
        // Planning workflow positional text is the requirement itself, not a
        // bug description.
        out.rawUserRequest = [out.rawUserRequest, t].filter(Boolean).join(' ');
      } else {
        // Treat as bug description
        out.workflow = 'bugfix';
        out.bugDescription = t;
      }
      continue;
    }
    const eq = t.indexOf('=');
    if (eq === -1) {
      const key = t.slice(2);
      if (VALUE_FLAGS.has(key) && i + 1 < tokens.length) {
        const value = tokens[++i]!;
        applyKey(out, key, value);
      } else if (key === 'skip-unit-tests') {
        out.options = { ...(out.options ?? {}), skipUnitTests: true };
      } else {
        out.options = { ...(out.options ?? {}), [key]: true } as import('../types/contracts.js').InvocationOptions;
      }
    } else {
      const key = t.slice(2, eq);
      const value = t.slice(eq + 1);
      applyKey(out, key, value);
    }
  }
}

function applyKey(out: NormalizeInput, key: string, value: string): void {
  // The old `parseToolArgv` set kebab→camelCase at the TOP LEVEL of
  // the result (so `r.clarifyMode`, `r.projectRoot` etc.). The new
  // `parseSkillArgv` puts them under `r.options.*` or as named fields.
  // For backwards compat we set BOTH the camelCase top-level alias
  // AND the canonical field.
  switch (key) {
    case 'project-root':
      out.projectRoot = value;
      break;
    case 'feature-dir':
      out.featureDir = value;
      break;
    case 'feature-id':
      out.featureId = value;
      break;
    case 'target':
      out.target = value;
      break;
    case 'mrd-url':
      out.mrdUrl = value;
      break;
    case 'clarify-mode':
      out.clarifyMode = value as 'dialogue' | 'batch';
      out.options = { ...(out.options ?? {}), clarifyMode: value as 'dialogue' | 'batch' };
      break;
    case 'skip-unit-tests':
      out.options = { ...(out.options ?? {}), skipUnitTests: parseBoolean(value, '--skip-unit-tests') };
      break;
    case 'unit-tests':
      out.options = { ...(out.options ?? {}), unitTests: parseBoolean(value, '--unit-tests') };
      break;
    case 'bug':
      out.bugDescription = value;
      break;
    default:
      out.options = { ...(out.options ?? {}), [key]: value } as import('../types/contracts.js').InvocationOptions;
  }
}

function parseBoolean(value: string, field: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError(`${field} must be true or false`);
}

/**
 * Build the `create` factory for `ctx.skills.registerProvider(...)`.
 *
 * The factory is called once at apply() time; the resulting provider
 * stays in the registry for the lifetime of the bundle. The
 * `SkillProviderControl` carries the lifecycle signal the SDK uses to
 * tear the provider down.
 */
export function buildSkillProviderFactory(deps: {
  packageRoot: string;
  defaultWorkflow: import('../types/contracts.js').WorkflowId;
}): (control: SkillProviderControl) => SkillProvider {
  // Discover skills at apply() time so we know what to expose. The
  // discovery is local and synchronous; if it ever needs I/O we move
  // it inside list() and cache.
  const skills = discoverSkills(deps.packageRoot);
  const providerName = 'dsh-feature-dev';
  return (_control: SkillProviderControl): SkillProvider => {
    return {
      name: providerName,
      list: async (_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> => {
        return skills.map<SkillCandidate>((s) => ({
          name: s.name,
          description: s.description,
          whenToUse: s.argumentHint,
          invocation: {
            modelInvocable: s.modelInvocable,
            userInvocable: s.userInvocable,
          },
          source: 'bundled' as SkillSource,
          provider: providerName,
          rank: BUNDLED_SKILL_RANK,
          resourceBase: { kind: 'directory', path: s.resourceBase },
          locator: { name: s.name },
        }));
      },
      get: async (candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> => {
        const skill = skills.find((s) => s.name === candidate.name);
        if (!skill) return undefined;
        return {
          name: skill.name,
          description: skill.description,
          whenToUse: skill.argumentHint,
          invocation: {
            modelInvocable: skill.modelInvocable,
            userInvocable: skill.userInvocable,
          },
          source: 'bundled' as SkillSource,
          provider: providerName,
          resourceBase: { kind: 'directory', path: skill.resourceBase },
          path: resolve(skill.resourceBase, 'SKILL.md'),
          content: skill.body,
        };
      },
    };
  };
}
