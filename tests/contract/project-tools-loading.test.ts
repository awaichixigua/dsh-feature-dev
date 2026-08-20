import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const AGENTS = [
  'agents/implementation-plan/tech-design.md',
  'agents/code-gen-tdd/tdd-test-spec.md',
  'agents/code-gen-tdd/code-impl.md',
  'agents/code-gen-tdd/code-review.md',
  'agents/code-gen-tdd/testcode-gen.md',
];

void test('planning and code-generation agents load matched project tool details', () => {
  for (const agent of AGENTS) {
    const instructions = readFileSync(resolve(ROOT, agent), 'utf8');
    assert.match(instructions, /arch-docs\/project-tools-index\.md/, `${agent} must load the index`);
    assert.match(instructions, /arch-docs\/project-tools\/\*\.md/, `${agent} must load matched details`);
    assert.match(instructions, /返回 `block`|停止实现并返回 `block`/, `${agent} must block on an unreadable matched detail`);
  }
});
