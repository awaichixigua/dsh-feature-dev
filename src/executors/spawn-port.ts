/**
 * Subagent Executor port.
 *
 * Calls into the real DSH `ctx.subagents.start(name, request)` API and
 * returns a normalized `SubagentResult` for the workflow driver.
 *
 * The runtime shape (rc.7) is:
 *   const run = await ctx.subagents.start(name, {
 *     prompt: ContentBlock[],
 *     parent: ctx.agent,
 *     signal: exec.signal,
 *     outputSchema: { ... }  // optional
 *   });
 *   try {
 *     const result = await run.result;   // SubagentResult
 *   } finally {
 *     await run.dispose();
 *   }
 *
 * The bundle keeps a thin adapter so the rest of the code only depends
 * on the `SubagentPort` interface and not on the SDK shape.
 */

import { ExecutorError } from '../runtime/errors.js';
import { parsePhaseResult, type SubagentPort, type SubagentInvokeArgs } from './protocol.js';
import type { DshContext } from '../dsh/context.js';
import type { SubagentRun, SubagentResult } from '../dsh/sdk.js';

interface SubagentRunHandle {
  /** The original SDK handle, exposed for advanced callers. */
  readonly run: SubagentRun;
  /** Dispose the run; idempotent. */
  dispose(): Promise<void>;
}

/**
 * Create a SubagentPort backed by the real DSH `ctx.subagents` service.
 */
export function makeDshSubagentPort(ctx: DshContext): SubagentPort {
  return {
    async invoke(args: SubagentInvokeArgs) {
      return runViaDsh(ctx, args);
    },
  };
}

async function runViaDsh(ctx: DshContext, args: SubagentInvokeArgs): Promise<{
  rawText: string;
  result?: import('../types/contracts.js').PhaseResult;
  stopReason?: string;
}> {
  try {
    const run = await ctx.subagents.start(args.provider, {
      // The bundle's `Agent` and `ContentBlock` are local stand-ins (see
      // src/dsh/sdk.ts). At the SDK boundary we cast to the real types
      // (which we can't import directly). The runtime values are
      // correct; the cast only bridges the type identity gap.
      prompt: args.prompt as never,
      parent: args.parent as never,
      signal: args.signal,
      label: args.label,
      // Forward the resolved ModelRoute so the SubagentRuntime uses
      // the configured provider/model for the child session.
      ...(args.agentOptions ? { agentOptions: args.agentOptions as never } : {}),
      ...(args.outputSchema ? { outputSchema: args.outputSchema as Parameters<typeof ctx.subagents.start>[1] extends { outputSchema?: infer T } ? T : never } : {}),
    });
    try {
      const result: SubagentResult = await run.result;
      const rawText = extractText(result);
      const structured = parseSubagentResult(result);
      // Some providers finish the child turn with a valid JSON result in the
      // final text but fail DSH's structured-output capture, which surfaces as
      // stopReason=error. Preserve fail-fast behavior when there is no usable
      // output; otherwise let the executor validate the text contract and mark
      // the accepted fallback as WARN with explicit evidence.
      if (result.stopReason !== 'completed') {
        if (!structured && rawText.trim().length === 0) {
          throw new ExecutorError(
            `子代理因“${String(result.stopReason)}”停止，且未返回可用输出`,
            { stopReason: String(result.stopReason) }
          );
        }
        return {
          rawText,
          result: structured,
          stopReason: String(result.stopReason),
        };
      }
      return { rawText, result: structured };
    } finally {
      await run.dispose();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ExecutorError(`subagents.start 调用失败：${msg}`, { provider: args.provider });
  }
}

/**
 * A null subagent port for tests / offline mode. Returns a synthetic
 * PhaseResult that the SDK-shaped code path would have produced.
 */
export function makeNullSubagentPort(): SubagentPort {
  return {
    async invoke(_args: SubagentInvokeArgs) {
      return {
        rawText: JSON.stringify({
          status: 'pass',
          summary: '离线子代理：未连接真实的 DSH SubagentRuntime',
          artifacts: [],
          evidence: ['null_subagent:placeholder'],
          changedFiles: [],
        }),
      };
    },
  };
}

/** Extract a textual view of a SubagentResult for the PhaseResult parser.
 *
 * Strategy: try `structured` first (the canonical PhaseResult JSON
 * when an outputSchema is satisfied), then fall back to `output`
 * (the assistant's last text block, which is what the model
 * actually said). Without the output fallback, a run that fails
 * to satisfy the outputSchema — but still produces a model reply
 * — would surface as an empty string, and the PhaseResult parser
 * would mark it `failed` with a misleading "Subagent output is
 * not valid JSON" message.
 */
function extractText(r: SubagentResult): string {
  if (r.structured !== null && r.structured !== undefined) {
    if (typeof r.structured === 'string') return r.structured;
    return JSON.stringify(r.structured);
  }
  for (const block of r.output) {
    // Real `ContentBlock` (from @deepseek-ai/dsh-llm) is a
    // discriminated union keyed on `type`. We only need the text.
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') return b.text;
  }
  return '';
}

function parseSubagentResult(r: SubagentResult): import('../types/contracts.js').PhaseResult | undefined {
  if (r.structured && typeof r.structured === 'object' && 'status' in r.structured) {
    const s = r.structured as { status?: unknown };
    if (s.status === 'pass' || s.status === 'warn' || s.status === 'block' || s.status === 'failed') {
      // The DSH schema intentionally tolerates missing list fields so an
      // otherwise-complete child turn is not discarded. Normalize it through
      // the same parser used for text fallbacks before handing it to the FSM.
      return parsePhaseResult(JSON.stringify(r.structured), []);
    }
  }
  return undefined;
}

export type { SubagentRunHandle };
