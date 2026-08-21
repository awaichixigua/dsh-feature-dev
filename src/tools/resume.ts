/**
 * `feature_dev_resume` — resume a paused / interrupted / blocked run.
 *
 * Terminal states (completed / aborted / failed) are NOT auto-resumable.
 * The caller must acknowledge the abort / clear the state out of band
 * and start a new run. The single terminal check is delegated to
 * `isTerminalStatus()` in `state-repository.ts` so the rules stay
 * in one place.
 */

import { shape, ok, fail, type ToolContext, type ToolResult } from './contract.js';
import { StateRepository, isTerminalStatus, rewindMostRecentFailure } from '../runtime/state-repository.js';
import { resolveProjectRoot, validateFeatureDir } from '../runtime/paths.js';
import { runWorkflow } from '../workflows/runner.js';
import { ConflictError, DshCompatibilityError, NotFoundError } from '../runtime/errors.js';
import type { FeatureDevInvocation, PendingConfirmation, PendingMainAction, PhaseResult, WorkflowId } from '../types/contracts.js';
import { makeDshSubagentPort, makeNullSubagentPort } from '../executors/spawn-port.js';
import { SubagentExecutor } from '../executors/protocol.js';
import type { DshContext } from '../dsh/context.js';
import type { Agent } from '../dsh/sdk.js';
import { Lifecycle } from '../runtime/lifecycle.js';
import { RunMetricsReporter } from '../metrics/reporter.js';

export interface ResumeArgs {
  projectRoot: string;
  featureDir: string;
  /**
   * Optional: which workflow to drive. If absent, the workflow
   * recorded in the persisted state is used. Useful for "mrd-to-code
   * → code-gen-tdd" cross-workflow resume, where the caller wants to
   * advance to a different workflow.
   */
  workflow?: WorkflowId;
  /** Optional: skip to a specific phase (must be allowed by the FSM). */
  skipToPhase?: string;
}

export interface ResumeOutput {
  runId: string;
  status: string;
  currentPhase: string;
  workflow: WorkflowId;
  featureDir: string;
  statePath: string;
  pendingConfirmations: PendingConfirmation[];
  pendingMainAction?: PendingMainAction;
  lastPhaseResult?: PhaseResult;
}

export async function resumeFeatureDev(
  ctx: ToolContext,
  rawArgs: unknown
): Promise<ToolResult<ResumeOutput>> {
  try {
    const args = shape<ResumeArgs>(rawArgs, {
      projectRoot: 'string',
      featureDir: 'string',
    });
    const projectRoot = resolveProjectRoot({ explicit: args.projectRoot });
    const featureDir = validateFeatureDir(args.featureDir, projectRoot);
    const repo = new StateRepository({ projectRoot, featureDir });
    if (!repo.exists()) {
      throw new NotFoundError('未找到可继续的 execution-state.json', { path: repo.statePath });
    }
    const state = repo.read();
    if (isTerminalStatus(state.status)) {
      throw new ConflictError(
        `运行已处于终态（${state.status}）；请新建一次运行后再重试`,
        { runId: state.runId, status: state.status }
      );
    }
    // Pending confirmation gates MUST be resolved before resume can
    // advance. Without this guard, calling resume while a gate is
    // open would silently skip the gate and roll the workflow
    // forward -- the "gate bypass" bug.
    if (state.pendingConfirmations.length > 0) {
      throw new ConflictError(
        '运行存在待确认事项；请先通过 feature_dev_confirm 处理后再继续',
        {
          runId: state.runId,
          pendingConfirmations: state.pendingConfirmations.map((c) => ({
            id: c.id,
            gate: c.gate,
            options: c.options,
          })),
        }
      );
    }
    if (state.status === 'blocked') {
      rewindMostRecentFailure(state);
      repo.writeAtomicPublic(state);
    } else if (state.status === 'interrupted') {
      state.status = 'running';
      state.updatedAt = new Date().toISOString();
      repo.writeAtomicPublic(state);
    }
    // Caller-supplied workflow wins over the one in state. This is
    // the bridge for cross-workflow resume (e.g. mrd-to-code →
    // code-gen-tdd after the implementation-plan gate is accepted).
    const workflow: WorkflowId = args.workflow ?? state.workflow;
    const inv: FeatureDevInvocation = {
      workflow,
      projectRoot,
      featureDir,
      featureId: state.featureId,
      bugDescription: state.bugDescription,
      target: args.skipToPhase,
      rawUserRequest: undefined,
      options: {
        resume: true,
        // Bugfix test execution is opt-in and must survive the LOCATE
        // confirmation boundary; other workflows retain their default.
        unitTests: state.workflow === 'bugfix' ? Boolean(state.unitTestsRequested) : true,
        generateUnitTestsOnly: false,
        clarifyMode: 'dialogue',
      },
    };
    const config = ctx.config ?? (await import('../config.js')).resolveConfig({});
    const port = ctx.dsh ? makeDshSubagentPort(ctx.dsh) : makeNullSubagentPort();
    // Production mode (ctx.dsh set): require a real parent Agent.
    // A bare `{}` would crash the SubagentRuntime when it reads
    // `parent.session.id`. Fixture mode (ctx.dsh undefined): use
    // the null port which never inspects parent, so a placeholder
    // is harmless.
    const parent: Agent = ctx.dsh
      ? requireAgent(ctx.agent, ctx.dsh)
      : ({} as unknown as Agent);
    const executor = new SubagentExecutor(port, {
      provider: config.subagentProvider,
      models: { ...(config.models ?? {}), ...(state.modelOverrides ?? {}) },
      parent,
      signal: ctx.signal,
    });
    // Lifecycle: same wiring as `feature_dev_run`. The reporter is
    // configured per workflow; on resume, the reporter's startRun hook
    // sees an in_progress state file and returns resumed=true.
    const metricsReporter = makeMetricsReporter(config);
    const metricsWorkflows = new Set<WorkflowId>(
      (config.metrics?.workflows ?? ['code-gen-tdd', 'bugfix']) as WorkflowId[]
    );
    const lifecycle = new Lifecycle({
      repo,
      strictGates: config.strictGates,
      ...(metricsReporter ? { metricsReporter, metricsWorkflows } : {}),
    });
    lifecycle.onRunStart(state, inv);
    const final = await runWorkflow(state, inv, {
      ctx,
      repo,
      created: false,
      executor,
      config,
      spawnBudget: { used: state.agentCount, max: config.maxTotalAgents },
      lifecycle,
    });
    await lifecycle.onRunEnd(final);
    return ok({
      runId: final.runId,
      status: final.status,
      currentPhase: final.currentPhase,
      workflow: final.workflow,
      featureDir: final.featureDir,
      statePath: new StateRepository({ projectRoot, featureDir: final.featureDir }).statePath,
      pendingConfirmations: final.pendingConfirmations,
      ...(final.pendingMainAction ? { pendingMainAction: final.pendingMainAction } : {}),
      ...(final.lastPhaseResult ? { lastPhaseResult: final.lastPhaseResult } : {}),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Refuse to silently substitute a placeholder Agent in production
 * mode — the SubagentRuntime reads `parent.session.id` and would
 * NPE. Throw a clear error so the harness reports a real bug.
 */
function requireAgent(agent: unknown, dsh: DshContext): Agent {
  if (agent) return agent as Agent;
  throw new DshCompatibilityError(
    'DSH ToolRunContext is missing `agent`; cannot resume subagents without a parent Agent',
    { availableServices: Object.keys(dsh) }
  );
}

/**
 * Build a metrics reporter if the config enables it. Mirrors the helper
 * in `run.ts` so the two entry points stay in lockstep.
 */
function makeMetricsReporter(config: import('../config.js').DshFeatureDevConfig): RunMetricsReporter | undefined {
  if (!config.metrics || config.metrics.enabled === false) return undefined;
  return new RunMetricsReporter({
    ...(config.metrics.reportUrl ? { reportUrl: config.metrics.reportUrl } : {}),
    ...(config.metrics.metricsHome ? { metricsHome: config.metrics.metricsHome } : {}),
    ...(typeof config.metrics.timeoutMs === 'number' ? { timeoutMs: config.metrics.timeoutMs } : {}),
    ...(typeof config.metrics.lineChangesEnabled === 'boolean'
      ? { lineChangesEnabled: config.metrics.lineChangesEnabled }
      : {}),
  });
}
