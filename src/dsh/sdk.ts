/**
 * DSH SDK re-exports.
 *
 * The bundle uses the real DSH SDK types. We never re-define them locally
 * to avoid protocol drift; the SDK is the single source of truth.
 *
 * If a future SDK version renames a symbol, this is the only file that
 * has to change.
 *
 * IMPORTANT — ContentBlock and Agent:
 *
 * The real `ContentBlock` lives in `@deepseek-ai/dsh-llm` and the real
 * `Agent` lives in `@deepseek-ai/dsh-agent`. NEITHER is symlinked at
 * the top-level `node_modules/@deepseek-ai/...` (pnpm keeps them in
 * the hashed `.pnpm/` store only as transitive deps of dsh-tools /
 * dsh-subagent). They are NOT directly importable from our source.
 *
 * For the bundle's own consumption we declare STRUCTURAL stand-ins
 * here that match the real shapes we use:
 *   - `ContentBlock` — only the `text` variant; structurally identical
 *     to dsh-llm's `TextBlock`. The bundle never constructs tool-call
 *     blocks itself; the DSH runtime emits those. Calls that need
 *     to hand a prompt to `ctx.subagents.start()` cast to the real
 *     type at the boundary.
 *   - `Agent` — opaque branded reference. The bundle never inspects
 *     fields; the SDK functions read fields internally. Boundaries
 *     use `unknown` casts.
 */

export {
  defineTool,
  ToolArgsError,
  ToolNotFoundError,
  ToolOutputError,
  TOOL_ABORTED,
  TOOL_ABORTED_BEFORE_DISPATCH,
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
} from '@deepseek-ai/dsh-tools';

export {
  SkillRegistry,
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
  BUNDLED_SKILL_RANK,
  isModelInvocable,
  isUserInvocable,
  isSkillName,
  renderSkillContent,
  escapeText,
} from '@deepseek-ai/dsh-skill';

export {
  SubagentRuntime,
  SubagentRunId,
  SubagentDepthError,
  SubagentError,
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  seedDescriptorTurn,
  SUBAGENT_DESCRIPTOR_VERSION,
  assertSubagentMaxDepth,
  delegationDepthOf,
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
  type SubagentProvider,
  type SubagentRun,
  type SubagentResult,
  type SubagentStartRequest,
  type SubagentRunInfo,
  type SubagentRunEndInfo,
  type SubagentStopReason,
  type SubagentStopReasonMap,
  type SubagentCapabilities,
  type ContinuableStart,
  type ContinuableStartSpec,
  type SubagentFollowupOptions,
  type SubagentInterruptAuthority,
  type SubagentReportOptions,
  type SubagentDescendantListEntry,
  type SubagentListEntry,
  type ResolvedSubagentStartRequest,
  type ContinuableCreateRequest,
  type ContinuableCreateSpec,
  type SubagentDescriptorData,
  type OneShotSubagentDescriptorData,
  type OneShotSubagentDescriptorInput,
  type ContinuableSubagentDescriptorData,
  type ContinuableSubagentDescriptorInput,
  type SubagentDescriptorInput,
} from '@deepseek-ai/dsh-subagent';

export type { Context } from '@deepseek-ai/cordis';
export type { Logger as CordisLogger } from '@deepseek-ai/cordis';

// ---- Local structural stand-ins for ContentBlock and Agent --------------

/**
 * The minimal `ContentBlock` we construct. Shape matches dsh-llm's
 * `TextBlock` exactly (the only variant the bundle ever emits in a
 * prompt). Pass `as unknown as RealContentBlock[]` at the SDK boundary
 * to hand these to `ctx.subagents.start()`.
 */
export interface ContentBlock {
  type: 'text';
  text: string;
}

/**
 * Opaque reference to a live DSH agent. The bundle never inspects
 * fields; it only carries the reference across boundaries. Use
 * `as unknown as RealAgent` at the SDK boundary.
 */
declare const agentBrand: unique symbol;
export interface Agent {
  readonly [agentBrand]: true;
}
