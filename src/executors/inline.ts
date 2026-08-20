/**
 * Inline executor.
 *
 * Reuses the current agent for the next phase. The DSH runtime
 * distinguishes `spawn` vs `inline` via the provider string passed to
 * `ctx.subagents.start(...)`. The same DshContext is used for both.
 */

import { makeDshSubagentPort, makeNullSubagentPort } from './spawn-port.js';
import type { SubagentPort } from './protocol.js';
import type { DshContext } from '../dsh/context.js';

/** A SubagentPort that uses DSH's inline provider. */
export function makeInlinePort(ctx: DshContext): SubagentPort {
  return makeDshSubagentPort(ctx);
}

/** A SubagentPort that always returns a synthetic PhaseResult. */
export const nullSubagentPort: SubagentPort = makeNullSubagentPort();
