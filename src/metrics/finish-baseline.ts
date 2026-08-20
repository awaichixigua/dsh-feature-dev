/**
 * finishRun baseline resolver.
 *
 * The original run may have started on baseline_tree=A, but by the time
 * the AI finishes, the human may have merged another MR and pushed HEAD
 * to a different commit. If we naively diff A..HEAD^{tree}, we'd report
 * the user's MR as part of "AI changes" — which is exactly the wrong KPI.
 *
 * Three signals decide which baseline to use at finish time:
 *   - `baseSha` / `baselineTreeSha` — the snapshot we took at run start
 *   - `resultSha` / `resultTreeSha` — what we just snapshotted at finish
 *   - `headTreeSha` — HEAD^{tree} right now
 *   - `explicitAiCommitSha` — the AI agent told us "I committed X";
 *                                if set, that commit's tree is the result
 *
 * Rule of thumb:
 *   - If HEAD advanced and there are worktree changes and no explicit
 *     AI commit, the new HEAD^{tree} is the "external" baseline and we
 *     diff headTree..resultTree. The AI's changes are then everything
 *     past the human's MR.
 *   - If there's an explicit AI commit, that commit IS the AI's work
 *     and we diff baselineTree..<ai commit tree>.
 *   - Otherwise we just diff baselineTree..resultTree as usual.
 */

import type { FinishBaseline } from './types.js';

export interface ResolveFinishBaselineArgs {
  baseSha: string;
  baselineTreeSha: string;
  resultSha: string;
  resultTreeSha: string;
  headTreeSha: string;
  explicitAiCommitSha?: string | null;
}

export function resolveFinishBaseline(args: ResolveFinishBaselineArgs): FinishBaseline {
  const headAdvanced = args.resultSha !== args.baseSha;
  const hasWorktreeChanges = args.resultTreeSha !== args.headTreeSha;
  const rebaseToCurrentHead = headAdvanced && hasWorktreeChanges && !args.explicitAiCommitSha;

  return {
    baseSha: rebaseToCurrentHead ? args.resultSha : args.baseSha,
    baselineTreeSha: rebaseToCurrentHead ? args.headTreeSha : args.baselineTreeSha,
    rebased: rebaseToCurrentHead,
    aiCommitSha: args.explicitAiCommitSha
      ? args.explicitAiCommitSha
      : headAdvanced && !rebaseToCurrentHead
        ? args.resultSha
        : null,
  };
}
