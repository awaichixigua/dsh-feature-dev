/**
 * Run metrics protocol — types and constants.
 *
 * Mirrors the wire shape the original `feature-dev/.workflow/scripts/feature-dev-run-metrics.js`
 * emits. Two protocol versions are recognised:
 *
 *   - SCHEMA_VERSION = "1.4" (default): line_changes contains only `production` rows.
 *     `test` / `other` rows are filtered out before counting, so a large test/config
 *     diff no longer blows the 5000-line cap and downgrades the whole report.
 *   - SCHEMA_VERSION_FALLBACK = "1.1": no line_changes at all. Sent when
 *     `lineChangesEnabled` is off, or when v1.4 collection itself throws.
 *
 * Cross-project invariant: `line_hash` and `context_hash` are bit-identical to the
 * `lib/feature-dev/observation.js` implementation inside `prd-clarify`. The shared
 * test vectors live in `tests/unit/metrics-line-fingerprint.test.ts`. If you touch
 * the algorithm, update the prd-clarify side in the same commit and re-run the
 * 100-hunk acceptance dataset.
 */

export const SCHEMA_VERSION: string = '1.4';
export const SCHEMA_VERSION_FALLBACK: string = '1.1';
export const MAX_LINE_CHANGES_PER_RUN = 5000;

/** Default upstream endpoint; overridden by FEATURE_DEV_REPORT_URL. */
export const DEFAULT_REPORT_URL = 'http://172.16.1.121:4319/api/v1/feature-dev/runs/report';
export const DEFAULT_TIMEOUT_MS = 10_000;
/** How many times we re-attempt a queue envelope before moving it to `failed/`. */
export const MAX_RETRY_ATTEMPTS = 8;

/** Run-type discriminator carried in every payload. */
export type RunType = 'code_gen' | 'bugfix';

/** The two workflow categories the lifecycle uses to feed the reporter timer. */
export type MetricsCategory = 'implementation' | 'test_generation' | 'repair';

export interface RunScope {
  type: 'feature' | 'full';
  target_feature_id: string | null;
  target_feature_suffix: string | null;
  target_feature_dependencies: string[];
}

export interface RunMetricsTimer {
  category: MetricsCategory;
  started_at: string;
  /** Set on stopTimer; null when abandoned. */
  finished_at: string | null;
  duration_seconds: number;
  abandoned: boolean;
}

export interface RunMetricsReportStatus {
  attempt_count: number;
  last_error: string | null;
  reported_at: string | null;
}

/**
 * Per-run state. Persisted under `<metricsHome>/runs/<sha256>.json`. Lifecycle
 * never holds this in memory — every reporter call re-reads the file so a
 * crashed run can be resumed from disk on the next start.
 */
export interface RunMetricsState {
  schema_version: string;
  run_id: string;
  status: 'in_progress' | 'pending' | 'reported' | 'failed' | 'no_effect';
  run_type: RunType;
  bug_id: string | null;
  bug_case_dir: string | null;
  binding_id: string | null;
  project_root: string;
  feature_dir: string;
  /** Path to `<featureDir>/ai/execution-state.md`; null for bugfix runs. */
  execution_state_path: string | null;
  bugfix_report_path: string | null;
  bugfix_report_fingerprint: string | null;
  session_id: string | null;
  requirement_id: string;
  repository: string;
  branch: string;
  scope: RunScope;
  base_sha: string;
  baseline_tree_sha: string;
  started_at: string;
  timers: RunMetricsTimer[];
  active_timer: { category: MetricsCategory; started_at: string } | null;
  payload: RunMetricsPayload | null;
  report: RunMetricsReportStatus;
  /** Optional: set by finishRun() so a re-finish can rebroadcast. */
  result_tree_sha?: string;
  finish_baseline_tree_sha?: string;
  finish_baseline_rebased?: boolean;
  finished_at?: string;
}

/** The line_change row shape (protocol 1.2+). */
export interface LineChangeEntry {
  path: string;
  old_path: string | null;
  hunk_index: number;
  /** Index of the +/- line within the hunk (no context rows). */
  line_index: number;
  change_type: 'added' | 'removed';
  old_line_no: number | null;
  new_line_no: number | null;
  line_hash: string;
  context_hash: string;
  /** Protocol 1.4: always "production". Older versions may also send "test" / "other". */
  category: 'production' | 'test' | 'other';
}

/** Top-level diff metrics (numstat-based). */
export interface RunMetricsTotals {
  ai_production_added_lines: number;
  ai_production_deleted_lines: number;
  ai_test_added_lines: number;
  ai_test_deleted_lines: number;
}

export interface RunMetricsPayload {
  schema_version: string;
  run_id: string;
  session_id: string | null;
  requirement_id: string;
  run_type: RunType;
  bug_id: string | null;
  scope: RunScope;
  git: {
    repository: string;
    branch: string;
    base_sha: string;
    result_sha: string;
    ai_commit_sha: string | null;
    patch_snapshot_ref: string | null;
    archive_sha: string | null;
  };
  time: {
    started_at: string;
    finished_at: string;
    ai_coding_seconds: number;
  };
  metrics: RunMetricsTotals;
  line_changes: LineChangeEntry[] | null;
  client_version: string;
}

/** Pending-queue envelope (persisted under `<metricsHome>/queue/pending/`). */
export interface QueueEnvelope {
  run_id: string;
  payload: RunMetricsPayload;
  /** Path back to the run state file so we can update attempt counters. */
  run_state_path: string;
  execution_state_path: string | null;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Configurable knobs for the reporter; layered over DSH bundle config. */
export interface MetricsReporterOptions {
  reportUrl: string;
  timeoutMs: number;
  metricsHome: string;
  lineChangesEnabled: boolean;
  clientVersion: string;
}

/** Decision the finish baseline resolver returns. */
export interface FinishBaseline {
  baseSha: string;
  baselineTreeSha: string;
  /** Set when we should report a rebased baseline (HEAD moved under our feet). */
  rebased: boolean;
  /** Set when an explicit AI commit tells us the HEAD movement is ours. */
  aiCommitSha: string | null;
}
