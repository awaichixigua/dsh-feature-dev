import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { resolveAgentPromptPath } from '../../src/workflows/agent-prompt-path.js';

void test('resolveAgentPromptPath prefers the workflow directory and falls back to shared', () => {
  const packageRoot = mkdtempSync(join(tmpdir(), 'dsh-agent-path-'));
  try {
    const workflowDir = join(packageRoot, 'agents', 'bugfix');
    const sharedDir = join(packageRoot, 'agents', 'shared');
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(workflowDir, 'bugfix-fix.md'), '# Bugfix fix');
    writeFileSync(join(sharedDir, 'prd-generator.md'), '# Shared PRD');

    assert.equal(
      resolveAgentPromptPath(packageRoot, 'bugfix', 'bugfix-fix'),
      join(workflowDir, 'bugfix-fix.md')
    );
    const shared = resolveAgentPromptPath(packageRoot, 'bugfix', 'prd-generator');
    assert.equal(shared, join(sharedDir, 'prd-generator.md'));
    assert.ok(existsSync(shared));
  } finally {
    rmSync(packageRoot, { recursive: true, force: true });
  }
});
