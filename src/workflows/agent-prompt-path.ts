/** Resolve a workflow-scoped prompt, with one shared-role fallback. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkflowId } from '../types/contracts.js';

/**
 * Agent prompts are grouped by their owning workflow under `agents/`.
 * Prompts intentionally reused by more than one workflow live in
 * `agents/shared/` and are resolved as a fallback.
 */
export function resolveAgentPromptPath(
  packageRoot: string,
  workflow: WorkflowId,
  subagent: string
): string {
  const workflowPath = resolve(packageRoot, 'agents', workflow, `${subagent}.md`);
  if (existsSync(workflowPath)) return workflowPath;
  return resolve(packageRoot, 'agents', 'shared', `${subagent}.md`);
}
