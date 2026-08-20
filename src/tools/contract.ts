/**
 * Tool contract.
 *
 * The `ToolContext` is the lightweight carrier passed to the bundle's
 * internal tool functions. It is NOT the DSH `ToolRunContext`; we keep
 * the DSH one opaque (it carries live Agent handles and AbortSignals
 * the rest of the bundle should not depend on). The tool layer reads
 * `projectRoot` and `featureDir` from the validated tool args.
 */

import type { FeatureDevInvocation } from '../types/contracts.js';
import { ValidationError, isFeatureDevError, toErrorPayload } from '../runtime/errors.js';
import type { DshFeatureDevConfig } from '../config.js';
import type { DshContext } from '../dsh/context.js';

export interface ToolContext {
  packageRoot: string;
  importMetaUrl: string;
  /** Opaque DSH ToolRunContext.agent. Used by tools that need to spawn subagents. */
  agent?: unknown;
  signal?: AbortSignal;
  /**
   * Resolved bundle config, captured at registerTools() time. Tools
   * MUST read this rather than calling `resolveConfig({})`, so the
   * cordis.patch.yml `config:` block is honored.
   */
  config?: DshFeatureDevConfig;
  /**
   * The live DSH context. `undefined` only in offline / null-DSH
   * scenarios (tests, fixtures). When set, this is the gateway to
   * `ctx.subagents.start` — i.e. the only way to spawn real
   * subagents rather than the null subagent.
   */
  dsh?: DshContext;
}

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
export function fail(e: unknown): ToolFailure {
  if (isFeatureDevError(e)) {
    return { ok: false, error: toErrorPayload(e) };
  }
  if (e instanceof Error) {
    return { ok: false, error: { code: 'E_INTERNAL', message: e.message } };
  }
  return { ok: false, error: { code: 'E_INTERNAL', message: String(e) } };
}

export function shape<T extends object>(
  args: unknown,
  required: Record<string, 'string' | 'boolean' | 'object' | 'array'>
): T {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('参数必须是对象', { got: typeof args });
  }
  const obj = args as Record<string, unknown>;
  for (const [k, t] of Object.entries(required)) {
    if (!(k in obj) || obj[k] === undefined) {
      throw new ValidationError(`缺少必填参数：${k}`, { key: k });
    }
    const v = obj[k]!;
    if (t === 'string' && typeof v !== 'string') {
      throw new ValidationError(`参数 ${k} 必须是字符串`, { key: k, got: typeof v });
    }
    if (t === 'boolean' && typeof v !== 'boolean') {
      throw new ValidationError(`参数 ${k} 必须是布尔值`, { key: k, got: typeof v });
    }
    if (t === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) {
      throw new ValidationError(`参数 ${k} 必须是对象`, { key: k });
    }
    if (t === 'array' && !Array.isArray(v)) {
      throw new ValidationError(`参数 ${k} 必须是数组`, { key: k });
    }
  }
  return obj as T;
}

export type { FeatureDevInvocation };
