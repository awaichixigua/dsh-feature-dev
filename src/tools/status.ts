/**
 * `feature_dev_status` — query the current state without modifying it.
 */

import { shape, ok, fail, type ToolContext, type ToolResult } from './contract.js';
import { StateRepository } from '../runtime/state-repository.js';
import { resolveProjectRoot, validateFeatureDir } from '../runtime/paths.js';
import { NotFoundError } from '../runtime/errors.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PendingConfirmation, PendingMainAction, PhaseResult } from '../types/contracts.js';

export interface StatusArgs {
  projectRoot: string;
  /** Query a specific run; defaults to current-run.json. */
  runId?: string;
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
      featureDir = pickLatestFeatureDir(projectRoot, args.runId);
    }
    const repo = new StateRepository({ projectRoot, featureDir, runId: args.runId });
    if (!repo.exists()) {
      throw new NotFoundError('No execution-state.json found', { path: repo.statePath });
    }
    const state = repo.read();
    let markdown: string | undefined;
    if (args.includeMarkdown) {
      const mdPath = repo.mdPath;
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
 * Walk projectRoot/req/feature/ai/current-run.json (or a requested runId)
 * and return the feature dir of the most-recently-modified run. Used when the
 * caller asks for project-scoped status without naming a feature.
 */
function pickLatestFeatureDir(projectRoot: string, runId?: string): string {
  const candidates: { featureDir: string; mtime: number }[] = [];
  const reqRoot = join(projectRoot, 'req');
  if (!existsSync(reqRoot)) {
    throw new NotFoundError('No req/ directory under projectRoot; no runs to report', {
      projectRoot,
    });
  }
  walk(reqRoot, (featureDir) => {
    const aiDir = join(featureDir, 'ai');
    const statePath = runId
      ? join(aiDir, 'runs', runId, 'execution-state.json')
      : resolveCurrentStatePath(aiDir);
    if (!statePath) return;
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

function resolveCurrentStatePath(aiDir: string): string | undefined {
  const pointerPath = join(aiDir, 'current-run.json');
  if (existsSync(pointerPath)) {
    try {
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as { runId?: unknown };
      if (typeof pointer.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(pointer.runId)) {
        return join(aiDir, 'runs', pointer.runId, 'execution-state.json');
      }
    } catch {
      // Ignore an invalid pointer and try the legacy layout.
    }
  }
  const legacy = join(aiDir, 'execution-state.json');
  if (existsSync(legacy)) return legacy;
  const runsDir = join(aiDir, 'runs');
  if (!existsSync(runsDir)) return undefined;
  const candidates: Array<{ path: string; mtime: number }> = [];
  try {
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(runsDir, entry.name, 'execution-state.json');
      if (!existsSync(path)) continue;
      candidates.push({ path, mtime: statSync(path).mtimeMs });
    }
  } catch {
    return undefined;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path;
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
