/**
 * Subagent Executor protocol.
 *
 * The executor's only job is to translate a `PhaseRequest` into a
 * `SubagentInvokeArgs` and convert the Subagent's output into a strict
 * `PhaseResult`.
 *
 * Two concrete ports:
 *  - `makeDshSubagentPort(ctx)` — talks to the real DSH `ctx.subagents`.
 *  - `makeNullSubagentPort()`  — for tests / offline mode.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ModelRole, ModelRoute, PhaseRequest, PhaseResult } from '../types/contracts.js';
import { ExecutorError, ValidationError } from '../runtime/errors.js';
import type { Agent, ContentBlock } from '../dsh/sdk.js';

/** Bundle-side subagent port. The DSH-side shape lives in the SDK. */
export interface SubagentPort {
  invoke(args: SubagentInvokeArgs): Promise<{
    rawText: string;
    result?: PhaseResult;
    /** Non-completed runtime reason when a validated text fallback is used. */
    stopReason?: string;
  }>;
}

export interface SubagentInvokeArgs {
  provider: string;
  prompt: ContentBlock[];
  parent: Agent;
  signal: AbortSignal;
  outputSchema?: unknown;
  label?: string;
  /**
   * Model route forwarded to the SubagentRuntime as the child agent's
   * model. The runtime uses this to pick provider/model/maxTokens
   * for the spawned session.
   */
  agentOptions?: {
    provider?: string;
    model?: string;
    maxTokens?: number;
  };
}

export interface ExecutorOptions {
  provider: 'spawn' | 'inline';
  /** Optional fallback route. When absent, DSH inherits the parent route. */
  defaultModel?: ModelRoute;
  /** Role routes resolved from plugin config plus per-run overrides. */
  models?: Partial<Record<ModelRole, ModelRoute>>;
  parent: Agent;
  signal?: AbortSignal;
  maxWallMs?: number;
}

/**
 * The SubagentExecutor drives a `PhaseRequest` end to end:
 *   1. build the prompt — first block is the role instructions read
 *      from the workflow-scoped `agents/<workflow>/<subagent>.md` prompt; subsequent blocks carry phase
 *      context, inputs, expected artifacts, and the output contract;
 *   2. hand it to the Subagent port (with the resolved model route);
 *   3. parse the result.
 *
 * Tests inject a custom port via `setPort`; production code uses
 * `makeDshSubagentPort(ctx)`.
 */
export class SubagentExecutor {
  private portOverride: SubagentPort | null = null;
  constructor(
    private readonly port: SubagentPort,
    private readonly opts: ExecutorOptions
  ) {}

  /** Inject a test port. Production never calls this. */
  setPort(port: SubagentPort): void { this.portOverride = port; }

  async run(req: PhaseRequest, opts?: { model?: ModelRoute; signal?: AbortSignal }): Promise<PhaseResult> {
    if (!req.promptPath) {
      throw new ValidationError('PhaseRequest 必须提供 promptPath');
    }
    const instructions = readAgentInstructions(req.promptPath);
    const role = readModelRole(instructions);
    const usedModel = opts?.model
      ?? (role ? this.opts.models?.[role] : undefined)
      ?? this.opts.defaultModel;
    const signal = opts?.signal ?? this.opts.signal;
    const prompt = buildPrompt(req, instructions);
    const port = this.portOverride ?? this.port;
    let raw: { rawText: string; result?: PhaseResult; stopReason?: string };
    try {
      raw = await port.invoke({
        provider: this.opts.provider,
        prompt,
        parent: this.opts.parent,
        signal: signal ?? new AbortController().signal,
        label: `workflow:${req.workflow} | phase:${req.phase}`,
        outputSchema: phaseResultOutputSchema(),
        ...(usedModel ? {
          agentOptions: {
            provider: usedModel.provider,
            model: usedModel.model,
          },
        } : {}),
      });
    } catch (e) {
      throw new ExecutorError(`子代理调用失败：${e instanceof Error ? e.message : '?'}`, { phase: req.phase });
    }
    const result = raw.result ?? parsePhaseResult(raw.rawText, req.expectedArtifacts);
    if (raw.stopReason && raw.stopReason !== 'completed') {
      result.evidence.push(`subagent_stop_reason:${raw.stopReason}:text_fallback_accepted`);
      if (result.status === 'pass') result.status = 'warn';
      result.summary += `（子代理在 stopReason=${raw.stopReason} 后返回的文本已通过结构校验）`;
    }
    return result;
  }
}

/** Build the prompt blocks for one phase. */
function buildPrompt(req: PhaseRequest, instructions: string): ContentBlock[] {
  // The first prompt block is intentionally a language policy. Child
  // sessions do not reliably inherit the parent system prompt, and this
  // must govern their progress narration as well as their final JSON.
  const languagePolicy = [
    '# 最高优先级：输出语言',
    '',
    '你正在中文对话中协作。除 JSON 字段名、状态枚举、代码、路径、命令、协议字段和必须保留的专有名词外，所有自然语言一律使用简体中文。',
    '这条规则覆盖整个执行过程：工具调用前后的进度说明、推理/分析说明、向父代理汇报的文字，以及最终 PhaseResult 的 summary、evidence、blocker 均须使用简体中文。',
    '不得输出英文句子、英文解释或英文摘要；若引用英文错误信息，应在后面用简体中文说明其含义。',
    'JSON 的键名和 status 枚举必须保持既有合约，不能翻译。',
  ].join('\n');

  const ruleLoadingPolicy = buildRuleLoadingPolicy(req);

  // 1. Language policy (first, because it must affect child narration).
  // 2. Rule loading policy. Rules stay on disk so the child can load only
  //    the scoped documents instead of receiving their contents inline.
  // 3. Role instructions from the workflow-scoped agent directory.
  // 4. Phase context + inputs + expected artifacts + output contract.
  const context: string[] = [];
  context.push(`# 阶段上下文`);
  context.push('');
  context.push(`运行 ID：${req.runId}`);
  context.push(`工作流：${req.workflow}`);
  context.push(`阶段：${req.phase}`);
  context.push(`项目根目录：${req.projectRoot}`);
  if (req.featureDir) context.push(`需求目录：${req.featureDir}`);
  if (req.featureId) context.push(`需求 ID：${req.featureId}`);
  context.push('');
  context.push('## 输入');
  context.push('```json');
  context.push(JSON.stringify(req.inputs, null, 2));
  context.push('```');
  context.push('');
  context.push('## 预期产物');
  for (const a of req.expectedArtifacts) context.push(`- ${a}`);
  context.push('');
  context.push('## 输出合约');
  context.push('必须只返回一个 JSON 对象，至少包含：');
  context.push('  { "status": "pass" | "warn" | "block" | "failed",');
  context.push('    "summary": "面向用户的简体中文摘要",');
  context.push('    "artifacts": ["已创建文件的路径"],');
  context.push('    "evidence": ["验证证据；说明文字使用简体中文"],');
  context.push('    "changedFiles": ["已修改文件"],');
  context.push('    "blocker"?: "status=block|failed 时必填，使用简体中文" }');
  context.push('');
  const prompt: ContentBlock[] = [
    { type: 'text', text: languagePolicy },
  ];
  if (ruleLoadingPolicy) prompt.push({ type: 'text', text: ruleLoadingPolicy });
  prompt.push(
    { type: 'text', text: instructions },
    { type: 'text', text: context.join('\n') },
  );
  return prompt;
}

/**
 * Restore feature-dev's on-demand rule injection model.
 *
 * Rule contents are deliberately not inlined: a child receives the concrete
 * package paths and must read them before work. Rule scope comes from the
 * directory convention:
 *   <packageRoot>/rules/common/ (all Markdown descendants)       all agents
 *   <packageRoot>/rules/<agent-name>/index.md                    that agent only
 *
 * Agent indexes select deeper, topic-specific rules on demand. This keeps a
 * large Java or test rule library out of every child prompt.
 */
function buildRuleLoadingPolicy(req: PhaseRequest): string | undefined {
  const packageRoot = packageRootFromAgentPrompt(req.promptPath);
  if (!packageRoot) return undefined;

  const agentName = basename(req.promptPath, '.md');
  const commonDirectory = join(packageRoot, 'rules', 'common');
  const commonRules = collectMarkdownRuleFiles(commonDirectory);
  if (commonRules.length === 0) {
    throw new ExecutorError('未找到子代理公共规则目录或其中的 Markdown 规则文件', {
      path: commonDirectory,
      agent: agentName,
    });
  }
  const agentIndex = join(packageRoot, 'rules', agentName, 'index.md');
  const agentRules = existsSync(agentIndex) ? [agentIndex] : [];

  return [
    '# 规则加载（必须执行）',
    '',
    '先使用文件读取工具逐份读取以下规则；不得凭记忆概括、跳过或要求父代理内联其正文。若任一文件不存在或无法读取，停止本阶段并返回 `status: "block"`，在 `blocker` 中写明路径和原因。',
    `规则根目录：\`${join(packageRoot, 'rules')}\`。专属规则的 index 会列出按需主题规则；读取 index 后，必须按其适用条件继续读取对应主题。`,
    '',
    '公共规则（所有 Agent 必读）：',
    ...commonRules.map((path) => `- 必读：\`${path}\``),
    ...(agentRules.length === 0
      ? []
      : [
        '',
        `专属规则（仅 ${agentName} 读取）：`,
        ...agentRules.map((path) => `- 必读：\`${path}\``),
      ]),
    '',
    '规则读取后再执行本阶段。规则与本 Agent 指令冲突时，以本 Agent 指令、阶段输入和项目内更具体的契约为准；其余情况严格遵守规则。',
  ].join('\n');
}

/** Return the package root only for standard <root>/agents/<group>/<agent>.md prompts. */
function packageRootFromAgentPrompt(promptPath: string): string | undefined {
  const agentsDirectory = dirname(dirname(promptPath));
  if (basename(agentsDirectory) !== 'agents') return undefined;
  return dirname(agentsDirectory);
}

/** Return all Markdown rules in lexical order, including nested rule groups. */
function collectMarkdownRuleFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectMarkdownRuleFiles(path);
      return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [path] : [];
    });
}

function readModelRole(instructions: string): ModelRole | undefined {
  const match = instructions.match(/^model_role:\s*(planning|coding|review|summary)\s*$/m);
  return match?.[1] as ModelRole | undefined;
}

/**
 * Read the agent's role-instructions file. The path is constructed by
 * the workflow driver as `<packageRoot>/agents/<workflow>/<subagent>.md`
 * (or `<packageRoot>/agents/shared/<subagent>.md`). If
 * the file is missing we DO NOT silently fall back to a stub —
 * Subagents would then have no role, and the model's behavior
 * collapses. The caller (workflow driver) is expected to validate
 * the file at apply() time and surface a clear error if any
 * referenced role is absent.
 */
function readAgentInstructions(promptPath: string): string {
  if (!existsSync(promptPath)) {
    throw new ExecutorError(
      `未找到子代理说明文件：${promptPath}`,
      { path: promptPath, agent: basename(promptPath, '.md') }
    );
  }
  return readFileSync(promptPath, 'utf8');
}

/** Output schema for a Subagent returning a PhaseResult. */
function phaseResultOutputSchema(): unknown {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pass', 'warn', 'block', 'failed'] },
      summary: { type: 'string' },
      artifacts: { type: 'array', items: { type: 'string' } },
      // Keep structured capture tolerant of a malformed child response.
      // parsePhaseResult() below normalizes list values to strings and fills
      // absent optional lists. A strict schema here makes DSH reject the
      // complete child turn before we can preserve its code changes or show a
      // useful contract warning to the parent.
      evidence: { type: 'array', items: {} },
      changedFiles: { type: 'array', items: {} },
      blocker: { type: 'string' },
      metrics: { type: 'object', additionalProperties: true },
      bugClassification: { type: 'string', enum: ['code_defect', 'business_requirement'] },
      bugCaseDir: { type: 'string' },
    },
    required: ['status'],
    additionalProperties: true,
  };
}

/**
 * Parse a PhaseResult from raw text (used when the Subagent returns
 * free-form text rather than a structured value).
 */
export function parsePhaseResult(rawText: string, expectedArtifacts: string[]): PhaseResult {
  const m = rawText.match(/```json\s*([\s\S]*?)```/);
  const jsonText = m ? m[1]! : rawText;
  let parsed: Partial<PhaseResult>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return {
      status: 'failed',
      summary: '子代理输出不是有效的 JSON',
      artifacts: [],
      evidence: [`json_error: ${e instanceof Error ? e.message : '?'}`],
      changedFiles: [],
    };
  }
  const status = parsed.status;
  if (status !== 'pass' && status !== 'warn' && status !== 'block' && status !== 'failed') {
    return {
      status: 'failed',
      summary: `子代理输出包含无效状态：${String(status)}`,
      artifacts: [],
      evidence: ['schema_violation:status'],
      changedFiles: [],
    };
  }
  const out: PhaseResult = {
    status,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    artifacts: stringifyList(parsed.artifacts),
    evidence: stringifyList(parsed.evidence),
    changedFiles: stringifyList(parsed.changedFiles),
    blocker: typeof parsed.blocker === 'string' ? parsed.blocker : undefined,
    metrics: parsed.metrics && typeof parsed.metrics === 'object' ? (parsed.metrics as Record<string, number>) : undefined,
    bugClassification: parsed.bugClassification === 'code_defect' || parsed.bugClassification === 'business_requirement'
      ? parsed.bugClassification
      : undefined,
    bugCaseDir: typeof parsed.bugCaseDir === 'string' ? parsed.bugCaseDir : undefined,
  };
  if (out.status === 'pass' && out.evidence.length === 0) {
    out.status = 'warn';
    out.summary += '（未附带验证证据，已降级为 warn）';
    out.evidence.push('auto_evidence:no_evidence_downgraded');
  }
  if (out.status === 'block' && !out.blocker) {
    out.summary += '（阻塞结果未提供解除条件）';
  }
  void expectedArtifacts;
  return out;
}

/** Convert permissive structured-output list values into the string contract. */
function stringifyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
}
