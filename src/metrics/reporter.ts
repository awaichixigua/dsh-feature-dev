/**
 * RunMetricsReporter — the DSH-native equivalent of the original
 * `feature-dev/.workflow/scripts/feature-dev-run-metrics.js` library.
 *
 * Lifecycle: created per-tool-call by the lifecycle layer; one instance
 * is shared across the run/resume flow because the underlying state is
 * persisted to disk and re-read on every call (so a crash + restart of
 * the harness picks up where it left off).
 *
 * Public API (mirrors the original):
 *   - startRun({ projectRoot, featureDir, runType, bugId, bindingId, featureId, ... })
 *   - startTimer({ ..., category })
 *   - stopTimer({ ... })
 *   - finishRun({ ..., featureDependencies, aiCommitSha })
 *   - flushQueue({ maxItems })
 *
 * All public methods are advisory: failures inside the reporter NEVER
 * throw past the lifecycle. Errors are written to the run state and to
 * stderr, so a flaky network never aborts a feature-dev run.
 *
 * Defaults:
 *   - reportUrl:    DEFAULT_REPORT_URL (overridden by FEATURE_DEV_REPORT_URL or option)
 *   - metricsHome:  ~/.feature-dev/metrics/ (overridden by FEATURE_DEV_METRICS_HOME or option)
 *   - timeoutMs:    10_000
 *   - lineChangesEnabled: true (overridden by FEATURE_DEV_LINE_CHANGES_ENABLED=false)
 *   - maxItems:     20
 *   - maxRetries:   MAX_RETRY_ATTEMPTS
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  gitBranch,
  gitHead,
  gitHeadTree,
  gitRepository,
  snapshotWorktree,
  canonicalPath,
  findGitRoot,
} from './git.js';
import { calculateLineChanges, calculateMetrics } from './diff-parser.js';
import { resolveFinishBaseline } from './finish-baseline.js';
import { buildPayload, refreshScopeDependencies } from './payload.js';
import { requirementIdFromBranch, scopeDetails } from './scope.js';
import {
  atomicWriteJson,
  ensureMetricsLayout,
  failedFileFor,
  fileFingerprint,
  metricsHome,
  queueFileFor,
  readJson,
  readJsonOptional,
  runStatePath,
  updateExecutionStateMetrics,
} from './state.js';
import {
  DEFAULT_REPORT_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRY_ATTEMPTS,
  SCHEMA_VERSION,
  SCHEMA_VERSION_FALLBACK,
  type LineChangeEntry,
  type MetricsCategory,
  type MetricsReporterOptions,
  type QueueEnvelope,
  type RunMetricsPayload,
  type RunMetricsState,
  type RunMetricsTotals,
  type RunType,
} from './types.js';

export class ReporterError extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ReporterError';
  }
}

export interface StartRunArgs {
  projectRoot: string;
  featureDir: string;
  runType: RunType;
  bugId?: string | null;
  bugCaseDir?: string | null;
  bindingId?: string | null;
  sessionId?: string | null;
  featureId?: string | null;
  featureSuffix?: string | null;
  featureDependencies?: string | string[] | null;
  /** Per-run Markdown projection path. */
  executionStatePath?: string | null;
  /** Override "now" for tests. */
  at?: string;
}

export interface TimerArgs {
  projectRoot: string;
  featureDir: string;
  runType: RunType;
  featureId?: string | null;
  featureSuffix?: string | null;
  featureDependencies?: string | string[] | null;
  bugId?: string | null;
  bugCaseDir?: string | null;
  bindingId?: string | null;
  sessionId?: string | null;
  category: MetricsCategory;
  at?: string;
}

export interface FinishRunArgs {
  projectRoot: string;
  featureDir: string;
  runType: RunType;
  featureId?: string | null;
  featureSuffix?: string | null;
  featureDependencies?: string | string[] | null;
  bugId?: string | null;
  bugCaseDir?: string | null;
  bindingId?: string | null;
  sessionId?: string | null;
  /** Caller can supply the SHA of an explicit AI commit if it knows it. */
  aiCommitSha?: string | null;
  /** Path to the per-run execution-state.md; required for code_gen, null for bugfix. */
  executionStatePath?: string | null;
  /** Path to the bugfix report; required for bugfix. */
  bugfixReportPath?: string | null;
  at?: string;
}

export interface FlushQueueArgs {
  maxItems?: number;
  force?: boolean;
}

type RunArgs = StartRunArgs | TimerArgs | FinishRunArgs | FlushQueueArgs;

interface NormalisedArgs {
  reportUrl: string;
  timeoutMs: number;
  metricsHome: string;
  lineChangesEnabled: boolean;
  clientVersion: string;
}

export class RunMetricsReporter {
  private readonly cfg: NormalisedArgs;

  constructor(
    private readonly opts: Partial<MetricsReporterOptions> = {},
    clientVersion: string = 'dsh-feature-dev/0.1.0'
  ) {
    this.cfg = normaliseOptions(this.opts, clientVersion);
    ensureMetricsLayout(this.cfg.metricsHome);
  }

  /** Lifecycle hook: a new run started. Writes the state file + binding. */
  startRun(args: StartRunArgs): { run_id: string; resumed: boolean; status: RunMetricsState['status'] } {
    // IMPORTANT: do NOT canonicalise the paths that go into the state
    // identity. realpathSync on Windows resolves 8.3 short paths
    // (e.g. `ADMINI~1`) to the long form, and that would make the
    // same logical project hash to two different state files. The
    // git subprocess calls below DO need a real path; we resolve
    // those separately on a per-command basis.
    const projectRoot = args.projectRoot;
    const featureDir = args.featureDir;
    const scope = scopeDetails({
      featureId: args.featureId ?? null,
      featureSuffix: args.featureSuffix ?? null,
      featureDependencies: args.featureDependencies ?? null,
    });
    const stateFile = runStatePath(this.cfg.metricsHome, {
      projectRoot,
      featureDir,
      scope,
      runType: args.runType,
      bugId: args.bugId ?? null,
      bindingId: args.bindingId ?? null,
    });

    if (existsSync(stateFile)) {
      const existing = readJson<RunMetricsState>(stateFile);
      if (existing.status === 'in_progress' || existing.status === 'pending') {
        updateExecutionStateMetrics(existing.execution_state_path, {
          metrics_run_id: existing.run_id,
          metrics_report_status: existing.status,
          metrics_started_at: existing.started_at,
          metrics_scope: existing.scope.type === 'feature' ? existing.scope.target_feature_id : 'full',
        });
        // Drain any envelopes from a previous crash before returning the
        // resumed run id; without this, a network blip on the last
        // attempt would leave the envelope in `pending/` forever.
        void this.flushQueue({ maxItems: 4 }).catch(() => {});
        return { run_id: existing.run_id, resumed: true, status: existing.status };
      }
    }

    // New run: drain any envelopes left by a previous crashed run.
    // Bounded so the boot path stays fast; the next run will pick up
    // anything that didn't fit in the first batch.
    void this.flushQueue({ maxItems: 4 }).catch(() => {});

    // Find the actual Git root: featureDir is always inside the project
    // (it's the directory the AI edited), so it is the most reliable
    // anchor. projectRoot is the fall-back for monorepos where the
    // workspace root is not itself a Git tree.
    const gitRoot = findGitRoot(featureDir, projectRoot);
    const gitCwd = gitRoot ?? canonicalPath(projectRoot);
    let branch: string;
    if (!gitRoot) {
      branch = 'detached';
    } else {
      try {
        branch = gitBranch(gitCwd);
      } catch {
        // Detached HEAD inside a real Git repo — record a placeholder so
        // the rest of the run still goes through. The server will
        // reject the report and we'll move the envelope to `failed/`.
        // We do NOT throw.
        branch = 'detached';
      }
    }
    let requirementId = '';
    try {
      requirementId = branch === 'detached' ? '0' : requirementIdFromBranch(branch);
    } catch {
      requirementId = '0';
    }

    const state: RunMetricsState = {
      schema_version: SCHEMA_VERSION,
      run_id: randomUUID(),
      status: 'in_progress',
      run_type: args.runType,
      bug_id: args.bugId ?? null,
      bug_case_dir: args.bugCaseDir ?? null,
      binding_id: args.bindingId ?? null,
      project_root: projectRoot,
      feature_dir: featureDir,
      execution_state_path: args.runType === 'code_gen'
        ? (args.executionStatePath ?? join(featureDir, 'ai', 'execution-state.md'))
        : null,
      bugfix_report_path: args.bugCaseDir ? join(args.bugCaseDir, 'bugfix-report.md') : null,
      bugfix_report_fingerprint: fileFingerprint(
        args.bugCaseDir ? join(args.bugCaseDir, 'bugfix-report.md') : null
      ),
      session_id: args.sessionId ?? null,
      requirement_id: requirementId,
      repository: gitRepository(gitCwd),
      branch,
      scope,
      base_sha: safeHead(gitCwd),
      baseline_tree_sha: safeSnapshot(gitCwd),
      started_at: nowIso(args.at),
      timers: [],
      active_timer: null,
      payload: null,
      report: { attempt_count: 0, last_error: null, reported_at: null },
    };
    atomicWriteJson(stateFile, state);
    updateExecutionStateMetrics(state.execution_state_path, {
      metrics_run_id: state.run_id,
      metrics_report_status: state.status,
      metrics_started_at: state.started_at,
      metrics_scope: state.scope.type === 'feature' ? state.scope.target_feature_id : 'full',
    });
    return { run_id: state.run_id, resumed: false, status: state.status };
  }

  /** Start (or resume) a coding timer. Idempotent on the same category. */
  startTimer(args: TimerArgs): { category: MetricsCategory; started_at: string; ignored?: boolean } {
    const { stateFile, state } = loadActiveState(this.cfg.metricsHome, args);
    if (state.status !== 'in_progress') {
      return { category: args.category, started_at: state.started_at, ignored: true };
    }
    if (state.active_timer?.category === args.category) {
      return { category: args.category, started_at: state.active_timer.started_at };
    }
    if (state.active_timer) {
      state.timers.push({
        ...state.active_timer,
        abandoned: true,
        finished_at: null,
        duration_seconds: 0,
      });
    }
    state.active_timer = { category: args.category, started_at: nowIso(args.at) };
    atomicWriteJson(stateFile, state);
    return { category: state.active_timer.category, started_at: state.active_timer.started_at };
  }

  /** Stop the active timer. No-op if none is active. */
  stopTimer(args: TimerArgs): { category: MetricsCategory; duration_seconds: number; ignored?: boolean } {
    const { stateFile, state } = loadActiveState(this.cfg.metricsHome, args);
    if (!state.active_timer) {
      return { category: args.category, duration_seconds: 0, ignored: true };
    }
    const finishedAt = nowIso(args.at);
    const duration = Math.max(
      0,
      Math.round(
        (Date.parse(finishedAt) - Date.parse(state.active_timer.started_at)) / 1000
      )
    );
    const result = {
      ...state.active_timer,
      finished_at: finishedAt,
      duration_seconds: duration,
      abandoned: false,
    };
    state.timers.push(result);
    state.active_timer = null;
    atomicWriteJson(stateFile, state);
    return { category: result.category, duration_seconds: duration };
  }

  /**
   * Compute the final payload and enqueue it for delivery.
   * Returns the same shape as `deliverQueueFile` for testability.
   */
  async finishRun(args: FinishRunArgs): Promise<{
    run_id: string;
    status: RunMetricsState['status'];
    error?: string;
  }> {
    const { stateFile, state } = loadActiveState(this.cfg.metricsHome, args);
    if (state.payload) {
      if (state.status === 'reported' || state.status === 'failed') {
        return { run_id: state.run_id, status: state.status };
      }
      const queued = queueFileFor(this.cfg.metricsHome, state.run_id);
      if (existsSync(queued)) {
        const result = await deliverQueueFile(queued, this.cfg, { force: true });
        return { run_id: result.run_id, status: result.status as RunMetricsState['status'] };
      }
    }
    if (state.status !== 'in_progress' && state.status !== 'no_effect') {
      // Do not throw — the lifecycle treats this as advisory.
      return { run_id: state.run_id, status: state.status, error: `cannot finish from ${state.status}` };
    }

    // Stop the running timer first so the coding-seconds total is final.
    if (state.active_timer) {
      const stopped = this.stopTimer({
        ...args,
        category: state.active_timer.category,
      });
      void stopped;
    }

    const refreshed = readJson<RunMetricsState>(stateFile);
    if (args.executionStatePath !== undefined) {
      refreshed.execution_state_path = args.executionStatePath;
    }
    refreshScopeDependencies(refreshed, args.featureDependencies ?? null);
    const resultTree = safeSnapshot(refreshed.project_root);
    const resultSha = safeHead(refreshed.project_root);
    const headTree = safeHeadTree(refreshed.project_root);
    const finishBaseline = resolveFinishBaseline({
      baseSha: refreshed.base_sha,
      baselineTreeSha: refreshed.baseline_tree_sha,
      resultSha,
      resultTreeSha: resultTree,
      headTreeSha: headTree,
      explicitAiCommitSha: args.aiCommitSha ?? null,
    });

    let totals: RunMetricsTotals;
    let lineChanges: LineChangeEntry[] | null = null;
    let schemaVersion = SCHEMA_VERSION;
    try {
      totals = calculateMetrics(refreshed.project_root, finishBaseline.baselineTreeSha, resultTree);
    } catch (e) {
      // numstat failure should not block the run — zero the totals and
      // downgrade the schema so the server still has a consistent shape.
      totals = {
        ai_production_added_lines: 0,
        ai_production_deleted_lines: 0,
        ai_test_added_lines: 0,
        ai_test_deleted_lines: 0,
      };
      schemaVersion = SCHEMA_VERSION_FALLBACK;
      if (process.env.DSH_FEATURE_DEV_METRICS_DEBUG === '1') {
        process.stderr.write(`[metrics] numstat failed: ${(e as Error).message}\n`);
      }
    }

    if (this.cfg.lineChangesEnabled) {
      try {
        lineChanges = calculateLineChanges(refreshed.project_root, finishBaseline.baselineTreeSha, resultTree);
      } catch (e) {
        schemaVersion = SCHEMA_VERSION_FALLBACK;
        lineChanges = null;
        if (process.env.DSH_FEATURE_DEV_METRICS_DEBUG === '1') {
          process.stderr.write(
            `[metrics] line_changes collection failed: ${(e as Error).message}; reporting as ${schemaVersion}\n`
          );
        }
      }
    } else {
      schemaVersion = SCHEMA_VERSION_FALLBACK;
    }

    const finishedAt = nowIso(args.at);
    const aiCommitSha = finishBaseline.aiCommitSha;
    const payload = buildPayload({
      state: refreshed,
      resultSha,
      resultTreeSha: resultTree,
      finishBaseline: {
        baseSha: finishBaseline.baseSha,
        baselineTreeSha: finishBaseline.baselineTreeSha,
        aiCommitSha,
      },
      totals,
      lineChanges,
      schemaVersion,
      finishedAt,
      clientVersion: this.cfg.clientVersion,
    });

    refreshed.result_tree_sha = resultTree;
    refreshed.finish_baseline_tree_sha = finishBaseline.baselineTreeSha;
    refreshed.finish_baseline_rebased = finishBaseline.rebased;
    refreshed.finished_at = finishedAt;
    refreshed.payload = payload;

    const addedLines =
      totals.ai_production_added_lines +
      totals.ai_production_deleted_lines +
      totals.ai_test_added_lines +
      totals.ai_test_deleted_lines;
    // The "no_effect" check is intentionally loose: the original script
    // uses `ai_production_added + ai_test_added` for the visibility test.
    const visibleLines = totals.ai_production_added_lines + totals.ai_test_added_lines;
    if (visibleLines === 0 && addedLines === 0) {
      refreshed.status = 'no_effect';
      atomicWriteJson(stateFile, refreshed);
      updateExecutionStateMetrics(refreshed.execution_state_path, {
        metrics_report_status: 'no_effect',
        metrics_finished_at: finishedAt,
        metrics_ai_added_lines: 0,
        metrics_ai_deleted_lines: 0,
        metrics_ai_coding_seconds: refreshed.timers
          .filter((t) => !t.abandoned)
          .reduce((acc, t) => acc + Number(t.duration_seconds || 0), 0),
      });
      return { run_id: refreshed.run_id, status: 'no_effect' };
    }

    refreshed.status = 'pending';
    atomicWriteJson(stateFile, refreshed);
    const envelope: QueueEnvelope = {
      run_id: refreshed.run_id,
      payload,
      run_state_path: stateFile,
      execution_state_path: refreshed.execution_state_path,
      attempt_count: 0,
      next_attempt_at: finishedAt,
      last_error: null,
      created_at: finishedAt,
      updated_at: finishedAt,
    };
    const queued = queueFileFor(this.cfg.metricsHome, refreshed.run_id);
    atomicWriteJson(queued, envelope);
    updateExecutionStateMetrics(refreshed.execution_state_path, {
      metrics_report_status: 'pending',
      metrics_finished_at: finishedAt,
      metrics_ai_added_lines: visibleLines,
      metrics_ai_deleted_lines: totals.ai_production_deleted_lines + totals.ai_test_deleted_lines,
      metrics_ai_coding_seconds: refreshed.timers
        .filter((t) => !t.abandoned)
        .reduce((acc, t) => acc + Number(t.duration_seconds || 0), 0),
    });
    const result = await deliverQueueFile(queued, this.cfg, { force: true });
    return { run_id: result.run_id, status: result.status as RunMetricsState['status'] };
  }

  /**
   * Drain the pending queue. Called at run-start (so a previous crashed
   * run's payload gets a chance to flush) and can also be called from
   * the lifecycle at any time as a background sweep.
   */
  async flushQueue(args: FlushQueueArgs = {}): Promise<{
    processed: number;
    results: Array<{ run_id?: string; status: string; error?: string }>;
  }> {
    const directory = join(this.cfg.metricsHome, 'queue', 'pending');
    if (!existsSync(directory)) return { processed: 0, results: [] };
    const files = readdirSync(directory)
      .filter((n) => n.endsWith('.json'))
      .sort()
      .slice(0, Number(args.maxItems ?? 20));
    const results: Array<{ run_id?: string; status: string; error?: string }> = [];
    for (const name of files) {
      try {
        results.push(await deliverQueueFile(join(directory, name), this.cfg, { force: args.force ?? false }));
      } catch (e) {
        results.push({ status: 'pending', error: (e as Error).message });
      }
    }
    return { processed: files.length, results };
  }
}

// ---- internals ---------------------------------------------------------

function normaliseOptions(
  opts: Partial<MetricsReporterOptions>,
  clientVersion: string
): NormalisedArgs {
  return {
    reportUrl: opts.reportUrl ?? process.env.FEATURE_DEV_REPORT_URL ?? DEFAULT_REPORT_URL,
    timeoutMs: opts.timeoutMs ?? (Number(process.env.FEATURE_DEV_REPORT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    metricsHome: metricsHome(opts.metricsHome ?? null),
    lineChangesEnabled:
      opts.lineChangesEnabled ?? lineChangesEnabledFromEnv(),
    clientVersion,
  };
}

function lineChangesEnabledFromEnv(): boolean {
  const env = process.env.FEATURE_DEV_LINE_CHANGES_ENABLED;
  if (env === 'false' || env === '0' || env === 'no') return false;
  if (env === 'true' || env === '1' || env === 'yes') return true;
  return true;
}

function loadActiveState(
  home: string,
  args: { projectRoot: string; featureDir: string; runType: RunType; bugId?: string | null; bugCaseDir?: string | null; bindingId?: string | null; featureId?: string | null; featureSuffix?: string | null; featureDependencies?: string | string[] | null }
): { stateFile: string; state: RunMetricsState } {
  // Same identity rule as startRun: do NOT canonicalise the identity
  // paths. realpathSync resolves Windows 8.3 short paths to the long
  // form and that would orphan the state file on subsequent calls.
  const projectRoot = args.projectRoot;
  const featureDir = args.featureDir;
  const scope = scopeDetails({
    featureId: args.featureId ?? null,
    featureSuffix: args.featureSuffix ?? null,
    featureDependencies: args.featureDependencies ?? null,
  });
  const stateFile = runStatePath(home, {
    projectRoot,
    featureDir,
    scope,
    runType: args.runType,
    bugId: args.bugId ?? null,
    bindingId: args.bindingId ?? null,
  });
  if (!existsSync(stateFile)) {
    throw new ReporterError('feature-dev metrics run has not been started', { stateFile });
  }
  return { stateFile, state: readJson<RunMetricsState>(stateFile) };
}

function nowIso(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error('invalid timestamp');
  return date.toISOString();
}

function safeHead(projectRoot: string): string {
  try { return gitHead(projectRoot); } catch { return ''; }
}
function safeHeadTree(projectRoot: string): string {
  try { return gitHeadTree(projectRoot); } catch { return ''; }
}
function safeSnapshot(projectRoot: string): string {
  try { return snapshotWorktree(projectRoot); } catch { return ''; }
}

// ---- queue delivery ----------------------------------------------------

interface DeliverOptions { force?: boolean }

/**
 * Single-shot queue delivery with exponential backoff. The decision tree
 * is: success → delete envelope, mark state reported. Permanent failure
 * (409 or MAX_RETRY_ATTEMPTS exhausted) → move to `failed/`. Transient
 * failure → rewrite envelope with bumped `next_attempt_at`.
 */
export async function deliverQueueFile(
  file: string,
  cfg: NormalisedArgs,
  options: DeliverOptions = {}
): Promise<{ run_id: string; status: string; error?: string; duplicate?: boolean }> {
  const envelope = readJson<QueueEnvelope>(file);
  const now = Date.now();
  if (!options.force && Date.parse(envelope.next_attempt_at || '0') > now) {
    return { run_id: envelope.run_id, status: 'pending' };
  }
  envelope.attempt_count = Number(envelope.attempt_count || 0) + 1;
  envelope.updated_at = new Date(now).toISOString();
  const result = await postPayload(envelope.payload, cfg);
  if (result.outcome === 'reported') {
    rmSync(file, { force: true });
    updateReportStatus(envelope, 'reported', cfg.metricsHome, {
      reported_at: new Date().toISOString(),
    });
    return { run_id: envelope.run_id, status: 'reported', duplicate: Boolean((result.body as { duplicate?: boolean } | null)?.duplicate) };
  }
  if (result.outcome === 'failed' || envelope.attempt_count >= MAX_RETRY_ATTEMPTS) {
    const failedFile = failedFileFor(cfg.metricsHome, envelope.run_id);
    envelope.last_error = result.error || null;
    atomicWriteJson(failedFile, envelope);
    rmSync(file, { force: true });
    updateReportStatus(envelope, 'failed', cfg.metricsHome, { error: result.error || null });
    return { run_id: envelope.run_id, status: 'failed', error: result.error };
  }
  const delaySeconds = Math.min(3600, 30 * 2 ** (envelope.attempt_count - 1));
  envelope.last_error = result.error || null;
  envelope.next_attempt_at = new Date(now + delaySeconds * 1000).toISOString();
  atomicWriteJson(file, envelope);
  updateReportStatus(envelope, 'pending', cfg.metricsHome, { error: result.error || null });
  return { run_id: envelope.run_id, status: 'pending', error: result.error, next_attempt_at: envelope.next_attempt_at } as { run_id: string; status: string; error?: string };
}

interface PostResult { outcome: 'reported' | 'retry' | 'failed'; status?: number; error?: string; body?: unknown }

async function postPayload(
  payload: RunMetricsPayload,
  cfg: NormalisedArgs
): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetch(cfg.reportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': payload.run_id,
        'User-Agent': `feature-dev/${payload.client_version}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    return { outcome: 'retry', error: `network error: ${(e as Error).message}` };
  }
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* leave null */ }
  if (response.status === 200 || response.status === 201) {
    return { outcome: 'reported', status: response.status, body };
  }
  if (response.status === 409) {
    return { outcome: 'failed', status: 409, error: readErrorCode(body) || 'report conflict' };
  }
  return { outcome: 'retry', status: response.status, error: readErrorCode(body) || `HTTP ${response.status}` };
}

function readErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'code' in body && typeof (body as { code: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return null;
}

function updateReportStatus(
  envelope: QueueEnvelope,
  status: RunMetricsState['status'],
  home: string,
  detail: { error?: string | null; reported_at?: string | null } = {}
): void {
  const stateFile = envelope.run_state_path;
  if (stateFile && existsSync(stateFile)) {
    const state = readJson<RunMetricsState>(stateFile);
    state.status = status;
    state.report = {
      attempt_count: envelope.attempt_count,
      last_error: (detail.error ?? state.report.last_error) ?? null,
      reported_at: (detail.reported_at ?? state.report.reported_at) ?? null,
    };
    atomicWriteJson(stateFile, state);
  }
  updateExecutionStateMetrics(envelope.execution_state_path, {
    metrics_run_id: envelope.run_id,
    metrics_report_status: status,
    metrics_report_attempts: envelope.attempt_count,
    metrics_reported_at: detail.reported_at ?? '—',
    metrics_report_error: detail.error ?? '—',
  });
  void home;
}

// Re-export the state type so downstream tests can import from one place.
export type { RunMetricsState, QueueEnvelope, RunMetricsPayload, LineChangeEntry, RunType, MetricsCategory };
