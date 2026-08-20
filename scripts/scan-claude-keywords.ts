/**
 * Scan the runtime tree (skills/, agents/, rules/, templates/, src/)
 * for Claude-specific references that should not exist in DSH-native
 * assets.
 *
 * Exits 0 if clean, 1 if any forbidden token is found.
 *
 * Usage: pnpm test:scan
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const FORBIDDEN = [
  '$ARGUMENTS',
  '${ARGUMENTS}',
  'CLAUDE_PLUGIN_ROOT',
  '$HOME/.claude',
  '~/.claude/',
  '/feature-dev:',
  '/plugin install',
  '/compact',
  'Task tool',
  'TodoWrite',
  'AskUserQuestion',
];

// Model role names that imply Claude-specific models. Allowed only
// in docs/ (migration notes), never in runtime assets.
const CLAUDE_MODELS = ['sonnet', 'haiku', 'opus'];

const SCAN_DIRS = ['skills', 'agents', 'rules', 'templates', 'src'];
const SCAN_FILES_GLOB = /\.(md|ts|js|json|ya?ml)$/;
// Directories we never enter.
const EXCLUDE = ['docs', 'node_modules', 'lib', '.git', 'tests/fixtures', 'scripts'];
// Files inside SCAN_DIRS where a hit is *expected* (the rule list / scanner).
const FILE_EXEMPTIONS: RegExp[] = [
  /rules\/README\.md$/i, // the rule catalog itself
  /src\/skills\/provider\.ts$/i, // the skill provider declares forbidden tokens
  /src\/runtime\/invocation\.ts$/i, // placeholder detection list
  /src\/runtime\/paths\.ts$/i, // path-banned-components list
];

interface Hit {
  file: string;
  line: number;
  pattern: string;
  lineText: string;
}

const hits: Hit[] = [];

for (const sub of SCAN_DIRS) {
  const root = join(ROOT, sub);
  if (!safeExists(root)) continue;
  walk(root, (file) => {
    if (!SCAN_FILES_GLOB.test(file)) return;
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const fileNorm = file.replace(/\\/g, '/');
    const exempt = FILE_EXEMPTIONS.some((re) => re.test(fileNorm));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const p of FORBIDDEN) {
        if (line.includes(p)) {
          if (exempt) continue;
          hits.push({ file, line: i + 1, pattern: p, lineText: line });
        }
      }
      for (const m of CLAUDE_MODELS) {
        const re = new RegExp(`\\b${m}\\b`, 'i');
        if (re.test(line)) {
          if (exempt) continue;
          hits.push({ file, line: i + 1, pattern: `model:${m}`, lineText: line });
        }
      }
    }
  });
}

if (hits.length === 0) {
  console.log('[OK] No Claude-specific references found in runtime assets.');
  process.exit(0);
}

console.error(`[FAIL] ${hits.length} Claude-specific references found:`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line} [${h.pattern}] ${h.lineText.trim()}`);
}
process.exit(1);

function walk(root: string, visit: (file: string) => void): void {
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (EXCLUDE.includes(e.name) || e.name.startsWith('.')) continue;
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) visit(p);
    }
  }
}

function safeExists(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
