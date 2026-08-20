/**
 * Public surface of the metrics module.
 *
 * The reporter, payload types, and helpers are the DSH-native equivalent
 * of `feature-dev/.workflow/scripts/feature-dev-run-metrics.js`. The
 * protocol is wire-compatible (schema 1.4, 1.1 fallback, identical
 * line_hash / context_hash), so the prd-clarify server can consume the
 * payload without changes.
 */

export {
  DEFAULT_REPORT_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_LINE_CHANGES_PER_RUN,
  MAX_RETRY_ATTEMPTS,
  SCHEMA_VERSION,
  SCHEMA_VERSION_FALLBACK,
  type FinishBaseline,
  type LineChangeEntry,
  type MetricsCategory,
  type MetricsReporterOptions,
  type QueueEnvelope,
  type RunMetricsPayload,
  type RunMetricsReportStatus,
  type RunMetricsState,
  type RunMetricsTimer,
  type RunMetricsTotals,
  type RunScope,
  type RunType,
} from './types.js';

export {
  fingerprintLine,
  fingerprintLineContextFromArray,
  normalizeLine,
  sha256,
} from './line-fingerprint.js';

export { classifyFile, type FileCategory } from './classify.js';

export {
  calculateLineChanges,
  calculateMetrics,
  parseHunks,
  type ParsedFile,
  type ParsedHunk,
  type ParsedHunkLine,
} from './diff-parser.js';

export {
  GitError,
  gitBranch,
  gitHead,
  gitHeadTree,
  gitRepository,
  readFileAtTree,
  snapshotWorktree,
} from './git.js';

export { resolveFinishBaseline, type ResolveFinishBaselineArgs } from './finish-baseline.js';

export { buildPayload } from './payload.js';

export {
  DEFAULT_METRICS_HOME,
  atomicWriteJson,
  ensureMetricsLayout,
  failedFileFor,
  fileFingerprint,
  metricsHome,
  queueFileFor,
  queuePaths,
  readJson,
  readJsonOptional,
  runStatePath,
  stateIdentity,
  updateExecutionStateMetrics,
} from './state.js';

export {
  normalizeFeatureSuffix,
  normalizeOptional,
  normalizeRunType,
  parseDependencies,
  requirementIdFromBranch,
  scopeDetails,
} from './scope.js';

export {
  ReporterError,
  RunMetricsReporter,
  deliverQueueFile,
  type FinishRunArgs,
  type FlushQueueArgs,
  type StartRunArgs,
  type TimerArgs,
} from './reporter.js';
