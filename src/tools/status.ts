/**
 * `feature_dev_status` — query the current state without modifying it.
 */

import { shape, ok, fail, type ToolContext, type ToolResult } from './contract.js';
import { StateRepository } from '../runtime/state-repository.js';
import { resolveProjectRoot, validateFeatureDir } from '../runtime/paths.js';
import { NotFoundError } from '../runtime/errors.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PendingConfirmation, PendingMainAction, PhaseResult } from '../types/contracts.js';

export interface StatusArgs {
  projectRoot: string;
  /**
   * Feature directory. Optional -- when omitted, the tool reports
   * the latest run on the projectRoot, regardless of feature.
   */
  featureDir?: string;
  /** Include the raw markdown projection. */
  includeMarkdown?: boolean;
}

export interface StatusOutput {
  runId: string;
  workflow: string;
  status: string;
  currentPhase: string;
  repairCount: number;
  pendingConfirmations: number;
  confirmations: PendingConfirmation[];
  pendingMainAction?: PendingMainAction;
  featureDir: string;
  statePath: string;
  lastPhaseResult?: PhaseResult;
  markdown?: string;
}

export async function statusFeatureDev(
  _ctx: ToolContext,
  rawArgs: unknown
): Promise<ToolResult<StatusOutput>> {
  try {
    const args = shape<StatusArgs>(rawArgs, {
      projectRoot: 'string',
    });
    const projectRoot = resolveProjectRoot({ explicit: args.projectRoot });
    // featureDir is optional. When absent, the caller is asking for
    // a project-scoped status snapshot. We pick the most recent run
    // on the projectRoot by scanning projectRoot/req/feature/ai/.
    let featureDir: string;
    if (args.featureDir) {
      featureDir = validateFeatureDir(args.featureDir, projectRoot);
    } else {
      featureDir = pickLatestFeatureDir(projectRoot);
    }
    const repo = new StateRepository({ projectRoot, featureDir });
    if (!repo.exists()) {
      throw new NotFoundError('No execution-state.json found', { path: repo.statePath });
    }
    const state = repo.read();
    let markdown: string | undefined;
    if (args.includeMarkdown) {
      const mdPath = resolve(repo.aiDir, 'execution-state.md');
      if (existsSync(mdPath)) markdown = readFileSync(mdPath, 'utf8');
    }
    return ok({
      runId: state.runId,
      workflow: state.workflow,
      status: state.status,
      currentPhase: state.currentPhase,
      repairCount: state.repairCount,
      pendingConfirmations: state.pendingConfirmations.length,
      confirmations: state.pendingConfirmations,
      ...(state.pendingMainAction ? { pendingMainAction: state.pendingMainAction } : {}),
      featureDir: state.featureDir,
      statePath: repo.statePath,
      ...(state.lastPhaseResult ? { lastPhaseResult: state.lastPhaseResult } : {}),
      ...(markdown !== undefined ? { markdown } : {}),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Walk projectRoot/req/feature/ai/execution-state.json and return the
 * feature dir of the most-recently-modified run. Used when the
 * caller asks for project-scoped status without naming a feature.
 */
function pickLatestFeatureDir(projectRoot: string): string {
  const candidates: { featureDir: string; mtime: number }[] = [];
  const reqRoot = join(projectRoot, 'req');
  if (!existsSync(reqRoot)) {
    throw new NotFoundError('No req/ directory under projectRoot; no runs to report', {
      projectRoot,
    });
  }
  walk(reqRoot, (featureDir) => {
    const aiDir = join(featureDir, 'ai');
    const statePath = join(aiDir, 'execution-state.json');
    if (!existsSync(statePath)) return;
    try {
      const mtime = statSync(statePath).mtimeMs;
      candidates.push({ featureDir, mtime });
    } catch {
      // ignore unreadable entries
    }
  });
  if (candidates.length === 0) {
    throw new NotFoundError('No execution-state.json found under any req/feature/ai/', {
      projectRoot,
    });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]!.featureDir;
}

function walk(root: string, visit: (dir: string) => void): void {
  // BFS over one level of root/feature -- we do not recurse
  // deeper because feature dirs are always direct children of
  // projectRoot/req/.
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    visit(join(root, e.name));
  }
}
