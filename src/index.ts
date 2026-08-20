/**
 * Plugin entry point.
 *
 * Loaded by DeepSeek Harness via the Bundle manifest. The runtime
 * calls `apply(ctx, config)` with a real `Context` from Cordis,
 * narrowed to `DshContext` here.
 *
 * Steps:
 *   1. Resolve the package root from `import.meta.url`.
 *   2. Resolve and normalize the config.
 *   3. Register the SkillProvider on `ctx.skills.registerProvider(create)`.
 *      The create factory is the shape rc.7 requires.
 *   4. Register the 4 `feature_dev_*` tools on `ctx.tools.register`.
 *      Each tool declares `output: { schema, render }` per rc.7.
 *   5. Stash the resolved config on the cordis context for tools.
 *
 * Tests import the building blocks directly; they do not call `apply`.
 */

import { resolvePackageRoot } from './runtime/paths.js';
import { resolveConfig, type DshFeatureDevConfig } from './config.js';
import { buildSkillProviderFactory } from './skills/provider.js';
import { registerTools } from './tools/register.js';
import { narrowContext, type DshContext } from './dsh/context.js';
import type { WorkflowId } from './types/contracts.js';

export const name = 'dsh-feature-dev';
export const version = '0.1.0';

/** Runtime services this plugin actually waits for before activation. */
export const inject = ['skills', 'tools', 'subagents', 'systemPrompt'] as const;

/**
 * The Cordis `apply` function. The runtime calls this with a real
 * `Context` once the bundle is activated.
 */
export function apply(rawCtx: unknown, rawConfig: Partial<DshFeatureDevConfig> = {}): void {
  // P0: the runtime MUST provide skills/tools/subagents. If any
  // service is missing, we throw at apply() time so the harness can
  // surface a clear error rather than failing later in a tool call.
  for (const k of inject) {
    if (!rawCtx || !(rawCtx as Record<string, unknown>)[k]) {
      throw new Error(`[dsh-feature-dev] DSH context is missing required service: ${k}`);
    }
  }
  const ctx: DshContext = narrowContext(rawCtx as Parameters<typeof narrowContext>[0]);
  const importMetaUrl = ctxImportMetaUrl();
  const packageRoot = resolvePackageRoot(importMetaUrl);
  const config = resolveConfig(rawConfig);
  const factory = buildSkillProviderFactory({
    packageRoot,
    defaultWorkflow: config.defaultWorkflow as WorkflowId,
  });
  // rc.7: registerProvider takes a synchronous factory that returns
  // the SkillProvider. The factory is invoked once at registration;
  // the returned provider stays in the registry for the bundle's life.
  ctx.skills.registerProvider(factory);
  registerTools(ctx, config);
  // Skill instructions govern workflow routing, but the parent agent also
  // emits user-facing narration before and after a tool call. Put the
  // language policy in the Harness system prompt so that narration and every
  // feature-dev skill share the same default.
  ctx.systemPrompt.section({
    name: 'dsh-feature-dev:language',
    order: 240,
    text: [
      '当使用 dsh-feature-dev 的 Skill 或 feature_dev_* 工具时，所有面向用户的说明、进度、结论、确认问题和错误提示必须使用简体中文。',
      '代码、文件路径、命令、JSON 字段名、状态枚举和第三方专有名词保持原样；不要为了中文化而翻译它们。',
      '子代理的结构化结果中，summary、blocker 以及 evidence 的说明文字必须使用简体中文。',
    ].join('\n'),
  });
  (ctx as unknown as { __dshFeatureDevConfig?: DshFeatureDevConfig }).__dshFeatureDevConfig = config;
  ctx.logger.info?.(`[dsh-feature-dev] applied: ${name}@${version}`);
}

function ctxImportMetaUrl(): string {
  try {
    return (import.meta as ImportMeta).url;
  } catch {
    return 'file:///__test__/dsh-feature-dev/src/index.ts';
  }
}

// ---- re-exports for direct usage -----------------------------------------

export {
  normalizeInvocation,
  parseSkillArgv,
  KNOWN_WORKFLOWS,
} from './runtime/invocation.js';
export { StateRepository, isTerminalStatus } from './runtime/state-repository.js';
export { runFeatureDev } from './tools/run.js';
export { resumeFeatureDev } from './tools/resume.js';
export { statusFeatureDev } from './tools/status.js';
export { confirmFeatureDev } from './tools/confirm.js';
export { registerTools, buildTools } from './tools/register.js';
export { discoverSkills, buildSkillProviderFactory, parseToolArgv } from './skills/provider.js';
export { resolvePackageRoot, resolveProjectRoot, validateFeatureDir } from './runtime/paths.js';
export {
  assertTransition,
  nextPhaseFromResult,
  getInitialPhase,
  getTerminalPhases,
} from './runtime/state-machine.js';
export { GateEngine, GATES } from './runtime/gate-engine.js';
export { validateArtifacts } from './runtime/artifact-validator.js';
export { SubagentExecutor, parsePhaseResult } from './executors/protocol.js';
export { makeDshSubagentPort, makeNullSubagentPort } from './executors/spawn-port.js';
export { narrowContext, type DshContext } from './dsh/context.js';
export {
  isFeatureDevError,
  toErrorPayload,
  FeatureDevError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  StateMachineError,
  GateError,
  DshCompatibilityError,
  ExecutorError,
} from './runtime/errors.js';
export { resolveConfig, DEFAULT_CONFIG, type MetricsConfig } from './config.js';

// Run-metrics reporter — DSH-native replacement for the original
// `feature-dev/.workflow/scripts/feature-dev-run-metrics.js` library.
// The Lifecycle (see `runtime/lifecycle.ts`) drives the reporter; tools
// never call it directly. Tests and any external consumer can import
// the lower-level helpers (e.g. `classifyFile`, `parseHunks`).
export {
  RunMetricsReporter,
  ReporterError,
  deliverQueueFile,
  // High-level API
  type StartRunArgs,
  type TimerArgs,
  type FinishRunArgs,
  type FlushQueueArgs,
  // Fingerprint + line_changes
  fingerprintLine,
  fingerprintLineContextFromArray,
  normalizeLine,
  sha256,
  // File classification + diff parsing
  classifyFile,
  calculateLineChanges,
  calculateMetrics,
  parseHunks,
  // Git helpers (also re-exported for tests)
  snapshotWorktree,
  gitHead,
  gitHeadTree,
  gitBranch,
  gitRepository,
  readFileAtTree,
  // Finish baseline
  resolveFinishBaseline,
  // State / queue IO
  atomicWriteJson,
  metricsHome,
  queueFileFor,
  queuePaths,
  readJson,
  readJsonOptional,
  runStatePath,
  stateIdentity,
  updateExecutionStateMetrics,
  // Types
  type RunMetricsState,
  type RunMetricsPayload,
  type RunMetricsTotals,
  type LineChangeEntry,
  type QueueEnvelope,
  type RunScope,
  type RunType,
  type MetricsCategory,
  type FinishBaseline,
  type FileCategory,
  type ParsedFile,
  type ParsedHunk,
  type ParsedHunkLine,
  // Constants
  DEFAULT_REPORT_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_METRICS_HOME,
  MAX_LINE_CHANGES_PER_RUN,
  MAX_RETRY_ATTEMPTS,
  SCHEMA_VERSION,
  SCHEMA_VERSION_FALLBACK,
} from './metrics/index.js';

// Real SDK re-exports — never re-define these locally.
export {
  defineTool,
  BUNDLED_SKILL_RANK,
  isModelInvocable,
  isUserInvocable,
  isSkillName,
  renderSkillContent,
  escapeText,
  type SkillProvider,
  type SkillProviderControl,
  type SkillProviderObservation,
  type SkillSummary,
  type SkillCandidate,
  type SkillDefinition,
  type SkillRegistration,
  type SkillInvocationPolicy,
  type SkillInvocationSource,
  type SkillLookupOptions,
  type SkillViewOptions,
  type SkillResourceBase,
  type SkillSource,
  type ToolDefinition,
  type ToolRuntime,
  type ToolRunContext,
  type ToolExecution,
  type ToolExecutionInput,
  type ToolExecutionResult,
  type ToolExecutionSuccess,
  type ToolExecutionMode,
  type ToolResult,
  type ToolOutputDefinition,
  type ToolCallView,
  type ToolResultView,
  type ParameterSchemaSpec,
  type ParameterJsonSchema,
  type ParameterPropertySpec,
  type ValueSchemaSpec,
  type ValueSchemaAnnotations,
  type StringValueSchemaSpec,
  type NumberValueSchemaSpec,
  type IntegerValueSchemaSpec,
  type BooleanValueSchemaSpec,
  type NullValueSchemaSpec,
  type ArrayValueSchemaSpec,
  type ObjectValueSchemaSpec,
  type JsonValueSchemaSpec,
  type OneOfValueSchemaSpec,
  type DefineToolOptions,
  type InferValue,
  type InferArgs,
  type JsonSchemaNode,
  type ObjectJsonSchema,
  type JsonValue,
  type SubagentProvider,
  type SubagentRun,
  type SubagentResult,
  type SubagentStartRequest,
  type SubagentRunInfo,
  type SubagentRunEndInfo,
  type SubagentStopReason,
  type SubagentStopReasonMap,
  type SubagentCapabilities,
  type ResolvedSubagentStartRequest,
  type ContinuableStart,
  type ContinuableStartSpec,
  type SubagentFollowupOptions,
  type SubagentInterruptAuthority,
  type SubagentReportOptions,
  type SubagentDescendantListEntry,
  type SubagentListEntry,
  type SubagentDescriptorData,
  type OneShotSubagentDescriptorData,
  type OneShotSubagentDescriptorInput,
  type ContinuableSubagentDescriptorData,
  type ContinuableSubagentDescriptorInput,
  type SubagentDescriptorInput,
  type ContinuableCreateRequest,
  type ContinuableCreateSpec,
  type Context,
  type Agent,
  type ContentBlock,
  type CordisLogger,
} from './dsh/sdk.js';

export type {
  FeatureDevInvocation,
  InvocationOptions,
  WorkflowId,
  PhaseRequest,
  PhaseResult,
  PhaseBudget,
  CodeGenPhase,
  ExecutionState,
  PhaseHistoryEntry,
  PendingConfirmation,
  RunEvent,
  ModelRole,
  ModelRoute,
} from './types/contracts.js';
export type { DshFeatureDevConfig, ModelRoleMap } from './config.js';
export type { SkillDescriptor } from './skills/provider.js';
