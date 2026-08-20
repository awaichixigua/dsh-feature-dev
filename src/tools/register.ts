/**
 * Register the 4 `feature_dev_*` tools on a real DSH `ctx.tools`.
 *
 * Uses the SDK's `defineTool` so the registry validates `parameters`
 * and enforces the `output: { schema, render }` contract that rc.7
 * requires.
 *
 * The DSH context (skills/tools/subagents) and the bundle config are
 * CLOSED OVER at `registerTools()` time, NOT pulled from a global
 * stash. Every tool's `execute` lambda runs through `runTool`, which
 * in turn builds the internal `ToolContext` with the live DSH
 * reference — this is the only way to reach `ctx.subagents.start`
 * from the bundle's per-tool functions, instead of falling through
 * to the null subagent.
 *
 * Canonical output envelope (matches `RESULT_SCHEMA`):
 *   { ok: true,  data: T }                                   on success
 *   { ok: false, error: { code, message, details? } }       on failure
 *
 * `runTool` normalizes thrown errors to `E_INTERNAL` and re-shapes
 * `data` to `JsonValue`.
 */

import { defineTool } from '../dsh/sdk.js';
import type { ToolDefinition, JsonValue, ToolRunContext } from '../dsh/sdk.js';
import type { DshContext } from '../dsh/context.js';
import { type DshFeatureDevConfig, resolveConfig } from '../config.js';
import { runFeatureDev } from './run.js';
import { resumeFeatureDev } from './resume.js';
import { statusFeatureDev } from './status.js';
import { confirmFeatureDev } from './confirm.js';
import { type ToolContext } from './contract.js';
import { isFeatureDevError } from '../runtime/errors.js';
import { resolvePackageRoot } from '../runtime/paths.js';

// ---- shared input schemas -----------------------------------------------

const PROJECT_ROOT = {
  type: 'string' as const,
  description: '业务项目根目录的绝对路径（包含 `req/` 的 Git 仓库）。',
} as const;

const FEATURE_DIR = {
  type: 'string' as const,
  description: '需求目录路径（绝对路径或相对 projectRoot）。示例：`req/create-order`。单次工作流 init、knowledge-base、code-question、prd-clarify、influence-menu 可省略；code-gen-tdd、implementation-plan、mrd-to-code、bugfix、archive 必填。',
} as const;

const WORKFLOW = {
  type: 'string' as const,
  description: '要执行的工作流：code-gen-tdd、implementation-plan、bugfix、archive、init、knowledge-base、code-question、prd-clarify、influence-menu、mrd-to-code 之一。',
  enum: [
    'mrd-to-code',
    'init',
    'knowledge-base',
    'implementation-plan',
    'code-gen-tdd',
    'bugfix',
    'archive',
    'code-question',
    'prd-clarify',
    'influence-menu',
  ] as const,
} as const;

// ---- shared output schema -----------------------------------------------

/**
 * The canonical tool output envelope. The per-tool functions return
 * this shape (see `ToolResult<T>` in `contract.ts`).
 */
export type ToolOutputEnvelope<T = JsonValue> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: JsonValue };
};

const RESULT_SCHEMA = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const },
    data: { type: 'json' as const },
    error: {
      type: 'object' as const,
      additionalProperties: true,
      properties: {
        code: { type: 'string' as const },
        message: { type: 'string' as const },
        details: { type: 'json' as const },
      },
    },
  },
  // The SDK's `ValueSchemaSpec` DSL does NOT support a `required` key.
  additionalProperties: true,
};

function renderResult(_args: unknown, value: JsonValue): unknown {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

// ---- tool registrations -------------------------------------------------

/** Bundle-side deps captured in each tool's execute closure. */
export interface ToolDeps {
  dsh: DshContext;
  config: DshFeatureDevConfig;
  packageRoot: string;
  importMetaUrl: string;
}

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  return [
    defineTool({
      name: 'feature_dev_run',
      description: '启动 feature_dev 工作流，并在 `<featureDir>/ai/` 下持久化状态。',
      parameters: {
        workflow: WORKFLOW,
        projectRoot: PROJECT_ROOT,
        featureDir: FEATURE_DIR,
        featureId: { type: 'string' },
        target: { type: 'string' },
        mrdUrl: { type: 'string' },
        bugDescription: { type: 'string' },
        bugCaseId: { type: 'string', description: 'bugfix 可选的纯数字缺陷编号，例如 `13`。' },
        rawUserRequest: { type: 'string' },
        options: { type: 'object', additionalProperties: true },
        modelOverrides: { type: 'object', additionalProperties: true },
      },
      output: { schema: RESULT_SCHEMA, render: renderResult as never },
      execute: (rawArgs, exec) =>
        runTool(deps, exec, (ctx) => runFeatureDev(ctx, rawArgs)) as never,
    }),
    defineTool({
      name: 'feature_dev_resume',
      description: '从持久化状态继续 paused / interrupted / blocked / aborted 的运行。',
      parameters: {
        projectRoot: { ...PROJECT_ROOT, required: true },
        // resume's implementation requires featureDir (StateRepository
        // is constructed with it) and refuses to load the state file
        // without it; mark required.
        featureDir: { ...FEATURE_DIR, required: true },
        workflow: WORKFLOW,
        skipToPhase: { type: 'string' },
      },
      output: { schema: RESULT_SCHEMA, render: renderResult as never },
      execute: (rawArgs, exec) =>
        runTool(deps, exec, (ctx) => resumeFeatureDev(ctx, rawArgs)) as never,
    }),
    defineTool({
      name: 'feature_dev_status',
      description: '读取当前运行状态，不修改任何文件。',
      parameters: {
        projectRoot: { ...PROJECT_ROOT, required: true },
        // status is project-scoped; featureDir is optional. The
        // implementation falls back to projectRoot if absent.
        featureDir: FEATURE_DIR,
        includeMarkdown: { type: 'boolean' },
      },
      output: { schema: RESULT_SCHEMA, render: renderResult as never },
      execute: (rawArgs, exec) =>
        runTool(deps, exec, (ctx) => statusFeatureDev(ctx, rawArgs)) as never,
    }),
    defineTool({
      name: 'feature_dev_confirm',
      description: '处理待确认门。可选：accept / proceed（继续）、revise（回退到门所在阶段）、abort（设为 aborted）、skip / continue / update（软确认）。',
      parameters: {
        projectRoot: { ...PROJECT_ROOT, required: true },
        // confirm must find the pending confirmation, which is keyed
        // by featureDir; mark required.
        featureDir: { ...FEATURE_DIR, required: true },
        gateId: { type: 'string' },
        gate: { type: 'string' },
        choice: { type: 'string', required: true },
      },
      output: { schema: RESULT_SCHEMA, render: renderResult as never },
      execute: (rawArgs, exec) =>
        runTool(deps, exec, (ctx) => confirmFeatureDev(ctx, rawArgs)) as never,
    }),
    /* Removed tool.
    defineTool({
      name: 'removed_tool',
      description: '检查插件运行环境和配置。',
      parameters: {
        projectRoot: { ...PROJECT_ROOT, required: true },
        featureDir: FEATURE_DIR,
      },
      output: { schema: RESULT_SCHEMA, render: renderResult as never },
      execute: (rawArgs, exec) =>
        runTool(deps, exec, (ctx) => confirmFeatureDev(ctx, rawArgs)) as never,
    }),
    */
  ];
}

export function registerTools(ctx: DshContext, rawConfig: Partial<DshFeatureDevConfig> = {}): void {
  const config = resolveConfig(rawConfig);
  const importMetaUrl = import.meta.url;
  const packageRoot = resolvePackageRoot(importMetaUrl);
  const deps: ToolDeps = { dsh: ctx, config, packageRoot, importMetaUrl };
  for (const tool of buildTools(deps)) {
    ctx.tools.register(tool);
  }
  // Stash config so other layers (e.g. workflows) can read it from
  // the context if needed.
  (ctx as unknown as { __dshFeatureDevConfig?: DshFeatureDevConfig }).__dshFeatureDevConfig = config;
}

// ---- internals ----------------------------------------------------------

/**
 * Wrap a per-tool call in the canonical envelope. `deps` carries the
 * live DSH context so the per-tool function can reach
 * `ctx.subagents.start` (or any other SDK service) instead of falling
 * through to the null subagent.
 */
async function runTool(
  deps: ToolDeps,
  exec: ToolRunContext,
  fn: (ctx: ToolContext & { dsh: DshContext; config: DshFeatureDevConfig }) => Promise<
    { ok: true; data: unknown } | { ok: false; error: { code: string; message: string; details?: unknown } }
  >
): Promise<{ data?: JsonValue; error?: { code?: string; message?: string; details?: JsonValue }; ok?: boolean }> {
  const ctx = toolCtxFrom(deps, exec);
  try {
    const r = await fn(ctx);
    if (r.ok) {
      return { ok: true, data: r.data as JsonValue };
    }
    return {
      ok: false,
      error: {
        code: r.error.code,
        message: r.error.message,
        ...(r.error.details !== undefined ? { details: r.error.details as JsonValue } : {}),
      },
    };
  } catch (e) {
    if (isFeatureDevError(e)) {
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          ...(e.details !== undefined ? { details: e.details as JsonValue } : {}),
        },
      };
    }
    return {
      ok: false,
      error: {
        code: 'E_INTERNAL',
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

function toolCtxFrom(
  deps: ToolDeps,
  exec: ToolRunContext
): ToolContext & { dsh: DshContext; config: DshFeatureDevConfig } {
  return {
    packageRoot: deps.packageRoot,
    importMetaUrl: deps.importMetaUrl,
    signal: exec.signal ?? new AbortController().signal,
    agent: exec.agent,
    dsh: deps.dsh,
    config: deps.config,
  };
}
