/**
 * The Cordis context the bundle is given at `apply()`.
 *
 * This is a structural alias for the live `Context` from
 * `@deepseek-ai/cordis` augmented with the bundle's required services.
 * It is provided only so callers can import a stable type that is
 * already narrowed to the services the bundle uses.
 *
 * For the actual implementations of these services, use the SDK
 * packages directly (`@deepseek-ai/dsh-skill`, `@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/dsh-subagent`).
 */

import type { Context } from '@deepseek-ai/cordis';
import type { SkillRegistry } from '@deepseek-ai/dsh-skill';
import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';

/** The narrowed context the bundle is given at apply() time. */
export interface DshContext {
  skills: SkillRegistry;
  tools: ToolRuntime;
  subagents: SubagentRuntime;
  logger: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void; debug?(msg: string, meta?: unknown): void };
  systemPrompt: {
    section(section: { name: string; order: number; text: string }): () => void;
  };
}

/** A bundle-specific narrow of the DSH `Context`. We type-assert at apply(). */
export function narrowContext(ctx: Context): DshContext {
  return ctx as unknown as DshContext;
}
