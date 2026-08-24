/**
 * Invocation Normalizer.
 *
 * Converts user input (a Skill's argument string, a tool arg map, or a
 * natural-language parse) into a strict `FeatureDevInvocation`. After
 * normalization, no other layer is allowed to re-parse user text.
 *
 * Goals:
 *  - Single point of truth for "what did the user ask for".
 *  - Reject incompatible flag combinations.
 *  - Reject ambiguous references (e.g. mrdUrl + featureDir unless explicit).
 *  - Resolve projectRoot + featureDir via path helpers.
 */

import { isAbsolute, resolve } from 'node:path';
import type { FeatureDevInvocation, InvocationOptions, WorkflowId } from '../types/contracts.js';
import { resolveProjectRoot, validateFeatureDir } from './paths.js';
import { ValidationError } from './errors.js';

const KNOWN_WORKFLOWS: ReadonlySet<WorkflowId> = new Set<WorkflowId>([
  'mrd-to-code',
  'knowledge-base',
  'implementation-plan',
  'code-gen-tdd',
  'bugfix',
  'archive',
  'prd-clarify',
  'influence-menu',
]);

export interface NormalizeInput {
  workflow: string;
  projectRoot?: string;
  featureDir?: string;
  featureId?: string;
  target?: string;
  mrdUrl?: string;
  bugDescription?: string;
  bugCaseId?: string;
  rawUserRequest?: string;
  options?: Partial<InvocationOptions>;
  modelOverrides?: FeatureDevInvocation['modelOverrides'];
  /**
   * Backwards-compat top-level alias for `options.clarifyMode`. The
   * old `parseToolArgv` set kebab flags at the top level; new
   * `parseSkillArgv` only writes the canonical `options.*` field. We
   * keep both for callers that still read the top-level alias.
   */
  clarifyMode?: 'dialogue' | 'batch';
}

/** Detect classic Claude-style placeholders that should never appear here. */
const CLAUDE_PLACEHOLDERS = [
  '$ARGUMENTS',
  '${ARGUMENTS}',
  'CLAUDE_PLUGIN_ROOT',
  '${CLAUDE_PLUGIN_ROOT}',
  '~/.claude',
  '/.claude/',
  '\\.claude\\',
  '/.claude',
  '.claude/',
  '.claude\\',
  '/feature-dev:',
  '${CLAUDE_PROJECT_DIR}',
];
function assertNoClaudePlaceholder(s: string | undefined, field: string) {
  if (!s) return;
  for (const p of CLAUDE_PLACEHOLDERS) {
    if (s.includes(p)) {
      throw new ValidationError(`Field ${field} contains Claude placeholder: ${p}`, { value: s, field });
    }
  }
}

export function normalizeInvocation(
  input: NormalizeInput,
  ctx: { importMetaUrl?: string; cwd?: string; defaultWorkflow?: WorkflowId }
): FeatureDevInvocation {
  const workflow = (input.workflow ?? ctx.defaultWorkflow ?? '').toLowerCase() as WorkflowId;
  if (!KNOWN_WORKFLOWS.has(workflow)) {
    throw new ValidationError(`Unknown workflow: ${input.workflow}`, {
      value: input.workflow,
      known: [...KNOWN_WORKFLOWS],
    });
  }

  // Argv / option safety (must run BEFORE projectRoot resolution so that
  // a Claude placeholder in the path is reported as such, not as
  // "projectRoot does not exist").
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') assertNoClaudePlaceholder(v, k);
  }
  if (input.options) {
    for (const [k, v] of Object.entries(input.options)) {
      if (typeof v === 'string') assertNoClaudePlaceholder(v, `options.${k}`);
    }
  }

  // Workflow-specific cross-field checks
  if (workflow === 'mrd-to-code' && !input.mrdUrl) {
    throw new ValidationError('mrd-to-code requires mrdUrl', { workflow });
  }
  if (workflow === 'bugfix' && !input.bugDescription) {
    throw new ValidationError('bugfix requires bugDescription', { workflow });
  }
  if (workflow === 'code-gen-tdd' && !input.featureDir) {
    throw new ValidationError('code-gen-tdd requires featureDir', { workflow });
  }

  // option mutex
  const opt = input.options ?? {};
  if (opt.resume && opt.generateUnitTestsOnly) {
    throw new ValidationError('options.resume and options.generateUnitTestsOnly are mutually exclusive');
  }
  if (opt.clarifyMode && opt.clarifyMode !== 'dialogue' && opt.clarifyMode !== 'batch') {
    throw new ValidationError(`Unknown clarifyMode: ${opt.clarifyMode}`);
  }
  const skipUnitTests = parseBooleanOption(opt.skipUnitTests, 'options.skipUnitTests');
  const legacyUnitTests = parseBooleanOption(opt.unitTests, 'options.unitTests');

  // paths
  const projectRoot = resolveProjectRoot({
    explicit: input.projectRoot,
    cwd: ctx.cwd,
  });
  let featureDir: string | undefined;
  if (input.featureDir) {
    // Accept either absolute or relative-to-projectRoot paths. The user
    // typically writes `req/create-order`, not an absolute path.
    const candidate = isAbsolute(input.featureDir)
      ? input.featureDir
      : resolve(projectRoot, input.featureDir);
    featureDir = validateFeatureDir(candidate, projectRoot);
  }

  const options: InvocationOptions = {
    resume: !!opt.resume,
    // Code-gen-tdd tests are opt-in solely through the command-facing
    // --skip-unit-tests=false. Ignore its legacy unitTests field so a stale
    // prompt cannot accidentally turn tests back on. Bugfix retains its
    // existing tool-level unitTests option for compatibility.
    unitTests: workflow === 'code-gen-tdd' || workflow === 'mrd-to-code'
      ? skipUnitTests === false
      : (skipUnitTests === undefined ? (legacyUnitTests ?? false) : !skipUnitTests),
    ...(skipUnitTests !== undefined ? { skipUnitTests } : {}),
    generateUnitTestsOnly: !!opt.generateUnitTestsOnly,
    clarifyMode: opt.clarifyMode ?? 'dialogue',
    skipMrdClarify: !!opt.skipMrdClarify,
    singlePhase: opt.singlePhase,
  };

  const out: FeatureDevInvocation = {
    workflow,
    projectRoot,
    featureDir,
    featureId: input.featureId,
    target: input.target,
    mrdUrl: input.mrdUrl,
    bugDescription: input.bugDescription,
    bugCaseId: input.bugCaseId,
    rawUserRequest: input.rawUserRequest,
    options,
    modelOverrides: input.modelOverrides,
  };
  return out;
}

/**
 * Helper for Skills that only have a raw text invocation. Parses
 * `--key=value` and `--key value` and positional args, then forwards to
 * normalizeInvocation.
 *
 * This is the *only* place user strings are split on whitespace.
 */
export function parseSkillArgv(argv: string): NormalizeInput {
  const tokens = tokenize(argv);
  if (tokens.length === 0) {
    throw new ValidationError('Empty invocation');
  }
  const out: NormalizeInput = { workflow: '' };
  const positional: string[] = [];
  // List of flags that consume the next token as a value (not a positional).
  const VALUE_FLAGS = new Set([
    'project-root',
    'feature-dir',
    'feature-id',
    'target',
    'mrd-url',
    'clarify-mode',
    'bug',
    'bug-id',
  ]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq === -1) {
        const key = t.slice(2);
        if (VALUE_FLAGS.has(key) && i + 1 < tokens.length) {
          const value = tokens[++i]!;
          applyKey(out, key, value);
        } else {
          out.options = { ...(out.options ?? {}), [key]: true } as InvocationOptions;
        }
      } else {
        const key = t.slice(2, eq);
        const value = t.slice(eq + 1);
        applyKey(out, key, value);
      }
    } else {
      positional.push(t);
    }
  }
  // Heuristics
  if (positional.length > 0 && !out.workflow) {
    // First positional is either the workflow name, the MRD URL, or the bug desc.
    const first = positional[0]!;
    if (/^https?:\/\//.test(first) || first.includes('share_doc') || first.endsWith('.md')) {
      out.mrdUrl = first;
      out.workflow = 'implementation-plan';
    } else if (KNOWN_WORKFLOWS.has(first.toLowerCase() as WorkflowId)) {
      out.workflow = first.toLowerCase();
    } else {
      // treat as bug description
      out.workflow = 'bugfix';
      out.bugDescription = first;
    }
  }
  if (positional.length > 1) {
    out.rawUserRequest = positional.slice(1).join(' ');
  }
  if (!out.workflow) {
    throw new ValidationError('Cannot determine workflow from invocation', { tokens });
  }
  return out;
}

function tokenize(s: string): string[] {
  // Simple shell-ish tokenizer. Supports double quotes; single quotes are treated literally.
  const out: string[] = [];
  let cur = '';
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && (ch === ' ' || ch === '\t')) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function applyKey(out: NormalizeInput, key: string, value: string): void {
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
      out.options = { ...(out.options ?? {}), clarifyMode: value as 'dialogue' | 'batch' };
      break;
    case 'skip-unit-tests':
      out.options = { ...(out.options ?? {}), skipUnitTests: parseBooleanOption(value, '--skip-unit-tests') };
      break;
    case 'unit-tests':
      out.options = { ...(out.options ?? {}), unitTests: parseBooleanOption(value, '--unit-tests') };
      break;
    case 'bug':
      out.bugDescription = value;
      break;
    case 'bug-id':
      out.bugCaseId = value;
      break;
    default:
      out.options = { ...(out.options ?? {}), [key]: value } as InvocationOptions;
  }
}

function parseBooleanOption(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError(`${field} must be true or false`);
}

export { KNOWN_WORKFLOWS };
