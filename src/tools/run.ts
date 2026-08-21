/**
 * `feature_dev_run` — start a new workflow run.
 */

import { shape, ok, fail, type ToolContext, type ToolResult } from './contract.js';
import { normalizeInvocation, KNOWN_WORKFLOWS } from '../runtime/invocation.js';
import { StateRepository } from '../runtime/state-repository.js';
import { resolveMrdStagingDir, validateFeatureDir } from '../runtime/paths.js';
import { basename } from 'node:path';
import { DshCompatibilityError } from '../runtime/errors.js';
import type { FeatureDevInvocation, PendingConfirmation, PhaseResult } from '../types/contracts.js';
import { runWorkflow } from '../workflows/runner.js';
import { makeDshSubagentPort, makeNullSubagentPort } from '../executors/spawn-port.js';
import { SubagentExecutor } from '../executors/protocol.js';
import type { DshContext } from '../dsh/context.js';
import type { Agent } from '../dsh/sdk.js';
import { resolveConfig } from '../config.js';
import { ensureBugCase } from '../runtime/bug-case.js';
import { Lifecycle } from '../runtime/lifecycle.js';
import { RunMetricsReporter } from '../metrics/reporter.js';
import type { WorkflowId } from '../types/contracts.js';

export interface RunArgs {
  workflow?: string;
  projectRoot?: string;
  featureDir?: string;
  featureId?: string;
  target?: string;
  mrdUrl?: string;
  bugDescription?: string;
  bugCaseId?: string;
  rawUserRequest?: string;
  options?: Record<string, unknown>;
  modelOverrides?: FeatureDevInvocation['modelOverrides'];
}

export interface RunOutput {
  runId: string;
  status: string;
  currentPhase: string;
  featureDir: string;
  statePath: string;
  pendingConfirmations: PendingConfirmation[];
  lastPhaseResult?: PhaseResult;
}

export async function runFeatureDev(
  ctx: ToolContext,
  rawArgs: unknown
): Promise<ToolResult<RunOutput>> {
  try {
    const args = shape<RunArgs>(rawArgs, {});
    const inv: FeatureDevInvocation = normalizeInvocation(
      {
        workflow: args.workflow ?? '',
        projectRoot: args.projectRoot,
        featureDir: args.featureDir,
        featureId: args.featureId,
        target: args.target,
        mrdUrl: args.mrdUrl,
        bugDescription: args.bugDescription,
        bugCaseId: args.bugCaseId,
        rawUserRequest: args.rawUserRequest,
        options: (args.options ?? {}) as unknown as FeatureDevInvocation['options'],
        modelOverrides: args.modelOverrides,
      },
      {
        importMetaUrl: ctx.importMetaUrl,
        cwd: readAgentCwd(ctx),
      }
    );
    if (inv.featureDir) {
      validateFeatureDir(inv.featureDir, inv.projectRoot);
    }
    if (!KNOWN_WORKFLOWS.has(inv.workflow)) {
      throw new Error(`Unknown workflow: ${inv.workflow}`);
    }
    // Keep the legacy document lifecycle: URL content first goes to a
    // deterministic hash directory.  SERVICE_ROUTER and BRANCH_GATE later
    // settle it into <service-repo>/req/<feature-name>.
    if ((inv.workflow === 'implementation-plan' || inv.workflow === 'mrd-to-code') && inv.mrdUrl) {
      if (!inv.featureDir) {
        throw new Error('implementation-plan requires featureDir so the routed service requirement directory can be named');
      }
      inv.featureId ??= basename(inv.featureDir);
      inv.featureDir = resolveMrdStagingDir(inv.projectRoot, inv.mrdUrl);
    }
    const repo = new StateRepository({
      projectRoot: inv.projectRoot,
      featureDir: inv.featureDir ?? inv.projectRoot,
    });
    const persistedBugCaseDir = inv.workflow === 'bugfix' && repo.exists()
      ? repo.read().bugCaseDir
      : undefined;
    const bugCaseDir = inv.workflow === 'bugfix'
      ? (inv.bugCaseId ? undefined : persistedBugCaseDir)
        ?? ensureBugCase({
          featureDir: inv.featureDir ?? inv.projectRoot,
          bugDescription: inv.bugDescription ?? '',
          bugCaseId: inv.bugCaseId,
        }).bugCaseDir
      : undefined;
    const { state, created } = repo.loadOrCreate({
      workflow: inv.workflow,
      projectRoot: inv.projectRoot,
      featureDir: inv.featureDir ?? inv.projectRoot,
      featureId: inv.featureId,
      bugDescription: inv.bugDescription,
      ...(inv.workflow === 'bugfix' ? { unitTestsRequested: inv.options.unitTests, bugCaseDir } : {}),
      modelOverrides: inv.modelOverrides,
      // Orchestrator workflows own their initial activeWorkflow.
      // For mrd-to-code, implementation-plan is the first sub; the
      // mrdToCode() orchestrator itself normalizes the state on the
      // first dispatch.
      ...(inv.workflow === 'mrd-to-code'
        ? { orchestratorWorkflow: 'mrd-to-code' as const, activeWorkflow: 'implementation-plan' as const }
        : {}),
    });
    // Config comes from the closure captured at registerTools(); it
    // already reflects cordis.patch.yml overrides. If a caller
    // (e.g. an integration test) calls runFeatureDev directly without
    // going through registerTools, fall back to a default-resolved
    // config so the tool still works.
    const config = ctx.config ?? resolveConfig({});
    // ctx.dsh presence distinguishes production vs offline mode.
    // Production: use the real DSH SubagentRuntime. Offline / fixture
    // (tests): use the null subagent port.
    const port = ctx.dsh ? makeDshSubagentPort(ctx.dsh) : makeNullSubagentPort();
    // In production mode the DSH runtime MUST provide a parent
    // Agent. A bare `{}` would crash the SubagentRuntime when it
    // reads `parent.session.id`. In fixture mode the null port
    // never inspects parent, so the placeholder is harmless.
    const parent: Agent = ctx.dsh
      ? requireAgent(ctx.agent, ctx.dsh)
      : ({} as unknown as Agent);
    const executor = new SubagentExecutor(port, {
      provider: config.subagentProvider,
      models: { ...(config.models ?? {}), ...(state.modelOverrides ?? {}) },
      parent,
      signal: ctx.signal,
    });
    const spawnBudget = { used: state.agentCount, max: config.maxTotalAgents };
    // Lifecycle: build with optional metrics reporter. The reporter is
    // scoped to the workflow list from the metrics config; one-shot
    // workflows and archive get no reporter hooks.
    const metricsReporter = makeMetricsReporter(config);
    const metricsWorkflows = new Set<WorkflowId>(
      (config.metrics?.workflows ?? ['code-gen-tdd', 'bugfix']) as WorkflowId[]
    );
    const lifecycle = new Lifecycle({
      repo,
      strictGates: config.strictGates,
      ...(metricsReporter ? { metricsReporter, metricsWorkflows } : {}),
    });
    // Run Start: kicks the reporter's baseline snapshot + requirement_id.
    lifecycle.onRunStart(state, inv);
    const runnerDeps = {
      ctx,
      repo,
      created,
      executor,
      config,
      spawnBudget,
      lifecycle,
    };
    let finalState = await runWorkflow(state, inv, runnerDeps);
    // Defensive backstop for legacy/adapter paths: a bugfix with a blocking
    // last phase result must never be reported as completed.
    if (inv.workflow === 'bugfix' && finalState.status === 'completed'
      && (finalState.lastPhaseResult?.status === 'block' || finalState.lastPhaseResult?.status === 'failed')) {
      finalState = repo.transition(finalState, 'BLOCKED');
    }
    // Run End: dispatch the metrics report (only on COMPLETED — see
    // Lifecycle.onRunEnd for the blocked/aborted/failed policy). We
    // await so the queue envelope is durable on disk before the tool
    // exits, otherwise a crash right after `return` would leave the
    // report un-flushed and a future resume would skip it.
    await lifecycle.onRunEnd(finalState);
    return ok({
      runId: finalState.runId,
      status: finalState.status,
      currentPhase: finalState.currentPhase,
      featureDir: finalState.featureDir,
      statePath: runnerDeps.repo.statePath,
      pendingConfirmations: finalState.pendingConfirmations,
      ...(finalState.lastPhaseResult ? { lastPhaseResult: finalState.lastPhaseResult } : {}),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Read the Agent session cwd, if any. The DSH `Session` exposes its
 * validated `cwd` under `agent.session.header.cwd` (NOT
 * `agent.session.cwd` — the latter is the live session object whose
 * cwd field is private). Prefer the header's cwd over the Node
 * process cwd so the project's working directory follows the
 * editor / harness, not the spawn location of `node`.
 */
function readAgentCwd(ctx: ToolContext): string | undefined {
  const agent = ctx.agent as { session?: { header?: { cwd?: unknown } } } | undefined;
  const cwd = agent?.session?.header?.cwd;
  return typeof cwd === 'string' ? cwd : undefined;
}

/**
 * Refuse to silently substitute a placeholder Agent in production
 * mode — the SubagentRuntime reads `parent.session.id` and would
 * NPE. Throw a clear error so the harness reports a real bug.
 */
function requireAgent(agent: unknown, dsh: DshContext): Agent {
  if (agent) return agent as Agent;
  throw new DshCompatibilityError(
    'DSH ToolRunContext is missing `agent`; cannot spawn subagents without a parent Agent',
    { availableServices: Object.keys(dsh) }
  );
}

/** A DshContext-shaped object whose subagent service points at the null port. */
export function makeNullDsh(): DshContext {
  return {
    skills: { registerProvider: () => () => {} } as unknown as DshContext['skills'],
    tools: { register: () => {} } as unknown as DshContext['tools'],
    subagents: {
      start: async () => ({
        id: 'test' as never,
        localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed', structured: null } as never),
        dispose: async () => {},
      }),
    } as unknown as DshContext['subagents'],
    systemPrompt: { section: () => () => {} },
    logger: { info() {}, warn() {}, error() {} },
  };
}

/**
 * Build a metrics reporter if the config enables it. Returns undefined
 * when the metrics block is disabled, so the lifecycle skips all reporter
 * calls. This is the single point where the reporter's wiring can be
 * turned off — every other layer just consults the lifecycle.
 */
function makeMetricsReporter(config: ReturnType<typeof resolveConfig>): RunMetricsReporter | undefined {
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
