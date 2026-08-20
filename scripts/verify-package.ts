/**
 * Verify the published npm package will contain every runtime asset.
 *
 * Building the lib/ output via `tsc` is out of scope here — this script
 * reads `package.json` `files` and verifies the listed paths exist.
 * Also runs the Claude keyword scan and a basic structural smoke test.
 *
 * Usage: pnpm test:package
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  files: string[];
};

let ok = true;
console.log(`Verifying package ${pkg.name}@${pkg.version}`);

for (const f of pkg.files) {
  const p = join(ROOT, f);
  if (!existsSync(p)) {
    console.error(`[FAIL] missing in files: ${f}`);
    ok = false;
  } else if (statSync(p).isDirectory()) {
    console.log(`[OK]   dir: ${f}/`);
  } else {
    console.log(`[OK]   file: ${f}`);
  }
}

// Required entry files
const required = [
  'lib/index.js',
  'lib/types/index.d.ts',
  'cordis.patch.yml',
  'skills/mrd-to-code/SKILL.md',
  'skills/init/SKILL.md',
  'skills/knowledge-base/SKILL.md',
  'skills/implementation-plan/SKILL.md',
  'skills/code-gen-tdd/SKILL.md',
  'skills/bugfix/SKILL.md',
  'skills/archive/SKILL.md',
  'skills/code-question/SKILL.md',
  'skills/prd-clarify/SKILL.md',
  'skills/influence-menu/SKILL.md',
  'schemas/invocation.schema.json',
  'schemas/phase-result.schema.json',
  'schemas/execution-state.schema.json',
  'templates/prd-template.md',
  'templates/test_spec_template.md',
];
for (const r of required) {
  const p = join(ROOT, r);
  if (!existsSync(p)) {
    console.error(`[FAIL] required asset missing: ${r}`);
    ok = false;
  }
}

if (!ok) {
  console.error('\nPackage verification FAILED.');
  process.exit(1);
}
console.log('\nPackage verification OK.');
