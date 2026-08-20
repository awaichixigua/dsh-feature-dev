/**
 * Build the wire payload that gets POSTed to `/api/v1/feature-dev/runs/report`.
 *
 * Three inputs:
 *   - the run state (read from `<metricsHome>/runs/<id>.json`)
 *   - the freshly-collected metrics + line_changes (from diff-parser)
 *   - the finish baseline + result SHA
 *
 * Output: a `RunMetricsPayload` ready for `JSON.stringify`. Schema version
 * is selected by the caller based on whether line_changes succeeded.
 */

import { parseDependencies } from './scope.js';
import {
  SCHEMA_VERSION,
  SCHEMA_VERSION_FALLBACK,
  type LineChangeEntry,
  type RunMetricsPayload,
  type RunMetricsState,
  type RunMetricsTotals,
} from './types.js';

export interface BuildPayloadArgs {
  state: RunMetricsState;
  resultSha: string;
  resultTreeSha: string;
  finishBaseline: { baseSha: string; baselineTreeSha: string; aiCommitSha: string | null };
  totals: RunMetricsTotals;
  lineChanges: LineChangeEntry[] | null;
  schemaVersion: string;
  finishedAt: string;
  clientVersion: string;
}

export function buildPayload(args: BuildPayloadArgs): RunMetricsPayload {
  const { state, resultSha, finishBaseline, totals, lineChanges, schemaVersion, finishedAt } = args;
  const codingSeconds = state.timers
    .filter((t) => !t.abandoned)
    .reduce((acc, t) => acc + Number(t.duration_seconds || 0), 0);

  return {
    schema_version: schemaVersion,
    run_id: state.run_id,
    session_id: state.session_id,
    requirement_id: state.requirement_id,
    run_type: state.run_type,
    bug_id: state.bug_id,
    scope: state.scope,
    git: {
      repository: state.repository,
      branch: state.branch,
      base_sha: finishBaseline.baseSha,
      result_sha: resultSha,
      ai_commit_sha: finishBaseline.aiCommitSha,
      patch_snapshot_ref: finishBaseline.aiCommitSha
        ? null
        : `local:git-tree:${finishBaseline.baselineTreeSha}..${args.resultTreeSha}`,
      archive_sha: null,
    },
    time: {
      started_at: state.started_at,
      finished_at: finishedAt,
      ai_coding_seconds: codingSeconds,
    },
    metrics: totals,
    line_changes: lineChanges,
    client_version: args.clientVersion,
  };
}

/**
 * Format helper used by the reporter when the user wants to keep the
 * dependency list on the state file in sync with the latest run input.
 * Wraps the standalone `parseDependencies` from `scope.ts` so the
 * payload builder is the single source of truth for "what the server
 * sees for dependencies".
 */
export function refreshScopeDependencies(
  state: RunMetricsState,
  featureDependencies: string[] | string | null | undefined
): void {
  const parsed = parseDependencies(featureDependencies);
  if (parsed.length > 0) {
    state.scope.target_feature_dependencies = parsed;
  }
}

export { SCHEMA_VERSION, SCHEMA_VERSION_FALLBACK };
