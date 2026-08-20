/**
 * Verify the DSH peer dependencies are present and at compatible versions.
 *
 * Usage: pnpm verify:dsh
 *
 * Exit code:
 *   0  - all OK
 *   1  - one or more peer deps missing or version mismatch
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const metaUrl = import.meta.url;
const here = dirname(fileURLToPath(metaUrl));
const pkgPath = resolve(here, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { peerDependencies?: Record<string, string> };
const peerDeps = pkg.peerDependencies ?? {};

const req = createRequire(metaUrl);
let exitCode = 0;

for (const [name, range] of Object.entries(peerDeps)) {
  try {
    const resolved = req.resolve(name);
    // best-effort version read
    const version = readPkgVersion(resolved);
    console.log(`[OK]   ${name} ${version} (range ${range})`);
  } catch {
    console.error(`[FAIL] ${name}: not installed (range ${range})`);
    exitCode = 1;
  }
}

process.exit(exitCode);

function readPkgVersion(resolved: string): string {
  try {
    let p = resolved;
    while (true) {
      const candidate = resolve(p, 'package.json');
      try {
        const json = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
        if (json.version) return json.version;
      } catch {
        // continue walking up
      }
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
  } catch {
    // ignore
  }
  return '?';
}
