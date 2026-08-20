/**
 * Plugin configuration shape.
 *
 * Loaded from cordis.patch.yml `config:` block at bundle activation time.
 * Field names mirror the schema documented in TECH_DESIGN.md §6.2.
 */
export interface DshFeatureDevConfig {
  /** Default workflow to dispatch when user input is ambiguous. */
  defaultWorkflow: WorkflowId;
  /** Subagent provider strategy. */
  subagentProvider: 'spawn' | 'inline';
  /** When true, workflow gates are enforced even if UI/host events are skipped. */
  strictGates: boolean;
  /** Hard cap on total subagents spawned by one persisted run. */
  maxTotalAgents: number;
  /** Hard cap on repair loop iterations before the run is BLOCKED. */
  maxRepairAttempts: number;
  /** Optional override of the model role → provider/model mapping. */
  models?: Partial<ModelRoleMap>;
  /** Roots where features may live. featureDir must resolve inside one of these. */
  allowedFeatureRoots?: string[];
  /** Where to write machine state files. Default `<projectRoot>/<featureDir>/ai`. */
  stateSubdir?: string;
  /**
   * Run-metrics reporter configuration. Leave `enabled: false` to
   * disable metrics reporting entirely (the lifecycle skips all
   * reporter calls in that case). When enabled, defaults are:
   *   - reportUrl = DEFAULT_REPORT_URL (overridden by env)
   *   - metricsHome = ~/.feature-dev/metrics/ (overridden by env)
   *   - lineChangesEnabled = true (overridden by env)
   *   - timeoutMs = 10_000
   * The reporter is wired only for workflows listed in `workflows`
   * (default: code-gen-tdd + bugfix). One-shot workflows and archive
   * never report.
   */
  metrics?: MetricsConfig;
}

export interface MetricsConfig {
  enabled: boolean;
  reportUrl?: string;
  metricsHome?: string;
  timeoutMs?: number;
  lineChangesEnabled?: boolean;
  /** Workflows the reporter hooks into. Default: code-gen-tdd, bugfix. */
  workflows?: WorkflowId[];
}

export type WorkflowId =
  | 'mrd-to-code'
  | 'init'
  | 'knowledge-base'
  | 'implementation-plan'
  | 'code-gen-tdd'
  | 'bugfix'
  | 'archive'
  | 'code-question'
  | 'prd-clarify'
  | 'influence-menu';

export type ModelRole = 'planning' | 'coding' | 'review' | 'summary';

export interface ModelRoute {
  provider: string;
  model: string;
}

export type ModelRoleMap = Record<ModelRole, ModelRoute>;

export const DEFAULT_CONFIG: DshFeatureDevConfig = {
  defaultWorkflow: 'code-gen-tdd',
  subagentProvider: 'spawn',
  strictGates: true,
  maxTotalAgents: 24,
  maxRepairAttempts: 3,
  metrics: {
    enabled: true,
    lineChangesEnabled: true,
    workflows: ['code-gen-tdd', 'bugfix'],
  },
};

/**
 * Merge user config over defaults. Model routes intentionally have no
 * built-in value: when a role is not explicitly configured, DSH inherits the
 * provider/model/maxTokens route from the parent conversation. This keeps the
 * plugin usable with every model provider configured in the host.
 */
export function resolveConfig(raw: Partial<DshFeatureDevConfig> | undefined): DshFeatureDevConfig {
  const base: DshFeatureDevConfig = { ...DEFAULT_CONFIG };
  if (!raw) return base;
  for (const k of Object.keys(raw) as (keyof DshFeatureDevConfig)[]) {
    const v = raw[k];
    if (v === undefined) continue;
    if (k === 'models') {
      base.models = { ...(v as Partial<ModelRoleMap>) };
    } else if (k === 'metrics') {
      // Deep-merge the metrics block so users can override one field
      // (e.g. `metrics: { enabled: false }`) without restating every default.
      const incoming = v as Partial<MetricsConfig> | undefined;
      if (incoming) {
        base.metrics = {
          ...(base.metrics ?? { enabled: true, workflows: ['code-gen-tdd', 'bugfix'] }),
          ...incoming,
          workflows: incoming.workflows ?? base.metrics?.workflows ?? ['code-gen-tdd', 'bugfix'],
        };
      }
    } else {
      // safe-assign: k is constrained to known keys
      (base as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return base;
}
