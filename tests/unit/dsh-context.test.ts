/**
 * P0-1: DSH context — the bundle must register skills via
 * ctx.skills.registerProvider and tools via ctx.tools.register; it
 * must throw at apply() time if any required service is missing.
 *
 * The new SDK (rc.7) shape:
 *   - `ctx.skills.registerProvider(factory)` — factory is
 *     `(control: SkillProviderControl) => SkillProvider`. We register
 *     one provider (via the factory) and the runtime invokes it.
 *   - `ctx.tools.register(tool)` — each tool is a `ToolDefinition`
 *     with `parameters` and `output: { schema, render }`.
 *
 * The old local `defineTool` shim is gone; we use the SDK's
 * `defineTool` straight from `@deepseek-ai/dsh-tools`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { apply, inject } from '../../src/index.ts';
import { buildSkillProviderFactory, discoverSkills } from '../../src/skills/provider.ts';
import { buildTools } from '../../src/tools/register.ts';
import { defineTool } from '../../src/dsh/sdk.js';
import { resolvePackageRoot } from '../../src/runtime/paths.js';
import type { DshContext } from '../../src/dsh/context.js';
import type { ToolDefinition, SkillProvider, ToolRunContext } from '../../src/dsh/sdk.js';

function makeNullDsh(partial: Partial<DshContext> = {}): DshContext {
  return {
    skills: { registerProvider: () => () => {} } as unknown as DshContext['skills'],
    tools: { register: () => {} } as unknown as DshContext['tools'],
    subagents: { start: async () => ({ id: 'x', localAgent: undefined, result: Promise.resolve({ stopReason: 'completed', structured: null } as never), dispose: async () => {} }) } as unknown as DshContext['subagents'],
    systemPrompt: { section: () => () => {} },
    logger: { info() {}, warn() {}, error() {} },
    ...partial,
  };
}

void test('inject only declares activatable DSH services', () => {
  assert.deepEqual(inject, ['skills', 'tools', 'subagents', 'systemPrompt']);
  assert.ok(!inject.includes('logger' as never), 'Cordis logger is built in, not an injectable service');
});

void test('apply() throws if skills service is missing', () => {
  const broken: DshContext = makeNullDsh({ skills: undefined as unknown as DshContext['skills'] });
  assert.throws(() => apply(broken, {}), /missing required service: skills/);
});

void test('apply() throws if tools service is missing', () => {
  const broken: DshContext = makeNullDsh({ tools: undefined as unknown as DshContext['tools'] });
  assert.throws(() => apply(broken, {}), /missing required service: tools/);
});

void test('apply() throws if subagents service is missing', () => {
  const broken: DshContext = makeNullDsh({ subagents: undefined as unknown as DshContext['subagents'] });
  assert.throws(() => apply(broken, {}), /missing required service: subagents/);
});

void test('apply() registers 1 provider (via factory) and 4 tools', () => {
  let factoryCalls = 0;
  const ctx: DshContext = {
    skills: {
      // rc.7: registerProvider takes a factory. We capture the call
      // count and ensure exactly one factory is registered.
      registerProvider(_create: (control: unknown) => SkillProvider) {
        factoryCalls += 1;
        return () => {};
      },
    },
    tools: {
      register(_t: ToolDefinition) { /* swallowed */ },
    },
    subagents: { start: async () => ({ id: 'x', localAgent: undefined, result: Promise.resolve({ stopReason: 'completed', structured: null } as never), dispose: async () => {} }) } as unknown as DshContext['subagents'],
    systemPrompt: { section: () => () => {} },
    logger: { info() {}, warn() {}, error() {} },
  };
  apply(ctx, {});
  assert.equal(factoryCalls, 1, 'registerProvider should be called exactly once');
});

void test('apply() registers 4 feature_dev_* tools', () => {
  const calls: ToolDefinition[] = [];
  const ctx: DshContext = {
    skills: { registerProvider: () => () => {} } as unknown as DshContext['skills'],
    tools: { register(t: ToolDefinition) { calls.push(t); } },
    subagents: { start: async () => ({ id: 'x', localAgent: undefined, result: Promise.resolve({ stopReason: 'completed', structured: null } as never), dispose: async () => {} }) } as unknown as DshContext['subagents'],
    systemPrompt: { section: () => () => {} },
    logger: { info() {}, warn() {}, error() {} },
  };
  apply(ctx, {});
  const names = calls.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'feature_dev_confirm',
    'feature_dev_resume',
    'feature_dev_run',
    'feature_dev_status',
  ]);
});

void test('buildTools produces 4 tools with parameters and output.render', () => {
  const tools = buildTools();
  assert.equal(tools.length, 4);
  for (const t of tools) {
    assert.ok(t.name.startsWith('feature_dev_'));
    assert.ok(t.description.length > 5);
    assert.ok(t.parameters, `${t.name} should declare parameters`);
    assert.ok(t.output, `${t.name} should declare output`);
    assert.equal(typeof t.output.render, 'function', `${t.name} output.render must be a function`);
    assert.equal(typeof t.execute, 'function', `${t.name} execute must be a function`);
  }
});

void test('buildSkillProviderFactory: produces a provider with async list + get', async () => {
  const packageRoot = resolvePackageRoot(import.meta.url);
  const factory = buildSkillProviderFactory({ packageRoot, defaultWorkflow: 'code-gen-tdd' });
  const provider = factory({} as never);
  // async list
  const list = await provider.list({} as never);
  assert.ok(list.length >= 9, `expected >= 9 skills; got ${list.length}`);
  for (const s of list) {
    assert.equal(s.invocation.userInvocable, true, `${s.name} should be user-invocable`);
  }
  // async get on a known candidate
  const first = list[0]!;
  const def = await provider.get(first, {} as never);
  assert.ok(def, 'get() should return a SkillDefinition for a known candidate');
  assert.ok(def!.content.length > 0, 'SkillDefinition.content should be non-empty');
});

void test('discoverSkills: lists >= 9 skills from this package', () => {
  const packageRoot = resolve(import.meta.dirname, '..', '..');
  const skills = discoverSkills(packageRoot);
  assert.ok(skills.length >= 9, `expected >= 9 skills; got ${skills.length}`);
});

void test('SDK defineTool: wraps spec into a ToolDefinition with parameters + output.render', async () => {
  // The SDK's `parameters` is a flat `Record<string, ParameterPropertySpec>`.
  // `required: true` is per-property, not a top-level array. Output schema
  // is the value-schema DSL (`additionalProperties: boolean` is mandatory
  // on object types).
  const t = defineTool({
    name: 't1',
    description: 'test',
    parameters: {
      name: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (rawArgs) => {
      const a = (rawArgs as { name?: string } | undefined) ?? {};
      return { greeting: `hello ${a.name ?? 'world'}` };
    },
  });
  assert.equal(t.name, 't1');
  assert.equal(typeof t.execute, 'function');
  // execute signature: (args, exec: ToolRunContext) => Promise<unknown>
  const exec = { signal: new AbortController().signal } as unknown as ToolRunContext;
  const out = await t.execute({ name: 'world' }, exec);
  assert.deepEqual(out, { greeting: 'hello world' });
});

const PKG_ROOT = resolve(import.meta.dirname, '..', '..');
void PKG_ROOT;
