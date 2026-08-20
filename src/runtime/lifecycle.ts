/**
 * Native Lifecycle.
 *
 * DSH exposes lifecycle hooks (Run Start, Phase Start, Pre/Post Tool,
 * Phase End, Turn Stop, Run End). This module wires each of them to a
 * meaningful side effect within the bundle.
 *
 * The lifecycle is intentionally thin: correctness lives in the workflow
 * state machine, not in lifecycle callbacks. Lifecycle is for *advisory*
 * behavior — logging, metrics, prefetch — so a missing UI event
 * never causes the workflow to skip a gate.
 *
 * Reporting responsibilities:
 *   - onRunStart  → metricsReporter.startRun() (baseline + requirement id)
 *   - onPhaseStart → metricsReporter.startTimer() (only for code-writing
 *                    phases on reporter-enabled workflows)
 *   - onPhaseEnd   → metricsReporter.stopTimer() + accumulate PhaseResult.metrics
 *   - onRunEnd     → metricsReporter.finishRun() (only when status === 'completed')
 *
 * All reporter calls are guarded by `metricsReporter` being defined and
 * `isMetricsEnabled(workflow)`. Failures inside the reporter are caught
 * locally so the run never aborts because the metrics server is down.
 */

import type { ExecutionState, FeatureDevInvocation, PhaseRequest, PhaseResult, WorkflowId } from '../types/contracts.js';
import type { StateRepository } from './state-repository.js';
import { assertTransition } from './state-machine.js';
import { GateError } from './errors.js';
import type { RunMetricsReporter, MetricsCategory } from '../metrics/index.js';
import { createHash } from 'node:crypto';

export interface LifecycleDeps {
  repo: StateRepository;
  strictGates: boolean;
  /**
   * Optional metrics reporter. When set, the lifecycle drives
   * startRun / startTimer / stopTimer / finishRun in addition to
   * the local advisory checks. When unset (e.g. in unit tests that
   * want pure state-machine coverage), every reporter call is a no-op.
   */
  metricsReporter?: RunMetricsReporter;
  /**
   * Optional set of workflows the metrics reporter should hook into.
   * Defaults to `code-gen-tdd` and `bugfix` when the reporter is set.
   * Any other workflow still goes through the lifecycle, but the
   * reporter is skipped.
   */
  metricsWorkflows?: ReadonlySet<WorkflowId>;
}

export class Lifecycle {
  constructor(private readonly deps: LifecycleDeps) {}

  /** Run Start: parse invocation, create runId, kick the reporter. */
  onRunStart(state: ExecutionState, inv: FeatureDevInvocation): void {
    if (this.deps.strictGates) {
      if (!inv.projectRoot) {
        throw new GateError('Run Start blocked: missing projectRoot');
      }
      if (!state.phaseHistory || state.phaseHistory.length === 0) {
        // first run; do nothing here — repo.create() already logged run_start
      }
    }
    this.safeMetricsStart(state, inv);
  }

  /** Phase Start: dependency check + claim; for code-writing phases, start a timer. */
  onPhaseStart(state: ExecutionState, phase: string): void {
    if (!state.currentPhase) {
      throw new GateError(`Phase Start blocked: no current phase claimed (target=${phase})`);
    }
    this.safeMetricsTimerStart(state, phase);
  }

  /** Pre Tool: scope & ownership check. */
  onPreTool(state: ExecutionState, tool: string, args: unknown): void {
    if (tool === 'feature_dev_resume' && state.status !== 'interrupted' && state.status !== 'paused' && state.status !== 'blocked') {
      throw new GateError('Pre Tool blocked: feature_dev_resume requires paused/interrupted/blocked run', {
        status: state.status,
      });
    }
    this.deps.repo.recordToolCall(state, tool, args);
  }

  /** Post Tool: record evidence; on phase end the workflow driver calls
   *  onPhaseEnd explicitly, so we only accumulate the PhaseResult metrics
   *  here when the post-tool callback carries a structured result. */
  onPostTool(state: ExecutionState, tool: string, result: unknown): void {
    if (tool === 'phase' && result && typeof result === 'object' && 'metrics' in result) {
      const m = (result as { metrics?: Record<string, number> }).metrics;
      if (m && typeof m === 'object') {
        state.notes = (state.notes ?? []).concat(
          `phase_metrics: ${JSON.stringify(m)}`
        );
      }
    }
  }

  /** Phase End: artifact validation + state advance + stop the timer. */
  onPhaseEnd(state: ExecutionState, phase: string, result: PhaseResult): void {
    if (result.status === 'pass' && result.evidence.length === 0) {
      throw new GateError('Phase End blocked: pass without evidence', { phase });
    }
    if (result.status === 'block' && !result.blocker) {
      throw new GateError('Phase End blocked: block without unblock-condition', { phase });
    }
    this.safeMetricsTimerStop(state, phase);
  }

  /** Turn Stop: ensure state is on disk and target reached. */
  onTurnStop(state: ExecutionState, targetReached: boolean): void {
    if (this.deps.strictGates && !targetReached && (state.status === 'running' || state.status === 'paused')) {
      // Only a warning: the run continues next turn.
      state.notes = (state.notes ?? []).concat(
        `Turn stop at phase ${state.currentPhase} without reaching target. State persisted.`
      );
    }
  }

  /** Run End: clean up resources + dispatch the metrics report.
   *
   *  Metrics is sent only for COMPLETED runs (per design: blocked /
   *  aborted / failed runs would distort the adoption KPI). The
   *  timer is stopped before finishRun so ai_coding_seconds is final.
   *
   *  Async: the tool layer MUST `await lifecycle.onRunEnd(state)` so
   *  the finishRun promise resolves before the tool returns. Fire-
   *  and-forget here would leave the queue envelope on disk while
   *  the run tool exits, defeating the retry policy. */
  async onRunEnd(state: ExecutionState): Promise<void> {
    if (state.pendingConfirmations.length > 0) {
      // carry forward: the run is being marked complete, so unresolved
      // confirmations are auto-accepted if non-blocking, otherwise recorded.
      for (const c of state.pendingConfirmations) {
        state.notes = (state.notes ?? []).concat(
          `Unresolved confirmation at run end: [${c.gate}] ${c.prompt}`
        );
      }
    }
    await this.safeMetricsFinish(state);
  }

  /** Enforce the state-machine invariant on every transition. */
  enforceTransition(state: ExecutionState, from: string, to: string): void {
    assertTransition(state.workflow, from, to, {
      lastResult: state.lastPhaseResult,
      repairCount: state.repairCount,
      maxRepairAttempts: this.deps.strictGates ? Number.MAX_SAFE_INTEGER : 999,
    });
  }

  /** Build a PhaseRequest from the current state and a target phase. */
  buildPhaseRequest(args: {
    state: ExecutionState;
    phase: string;
    promptPath: string;
    inputs: Record<string, unknown>;
    expectedArtifacts: string[];
    mode?: PhaseRequest['mode'];
  }): PhaseRequest {
    return {
      runId: args.state.runId,
      workflow: args.state.workflow,
      phase: args.phase,
      projectRoot: args.state.projectRoot,
      featureDir: args.state.featureDir,
      featureId: args.state.featureId,
      promptPath: args.promptPath,
      inputs: args.inputs,
      expectedArtifacts: args.expectedArtifacts,
      mode: args.mode ?? 'normal',
    };
  }

  // ---- reporter wiring (all best-effort, never throw) -------------------

  private safeMetricsStart(state: ExecutionState, inv: FeatureDevInvocation): void {
    if (!this.isMetricsEnabled(state)) return;
    const runType = this.runTypeOf(state);
    try {
      this.deps.metricsReporter?.startRun({
        projectRoot: state.projectRoot,
        featureDir: state.featureDir,
        runType,
        sessionId: state.runId,
        featureId: state.featureId ?? inv.featureId ?? null,
        ...(state.bugDescription ? { bugId: deriveBugIdFromDescription(state.bugDescription) } : {}),
      });
    } catch (e) {
      // The reporter is advisory; never let it block a run.
      this.appendMetricError(state, 'start', e);
    }
  }

  private safeMetricsTimerStart(state: ExecutionState, phase: string): void {
    if (!this.isMetricsEnabled(state)) return;
    const category = phaseToCategory(phase);
    if (!category) return;
    const runType = this.runTypeOf(state);
    try {
      this.deps.metricsReporter?.startTimer({
        projectRoot: state.projectRoot,
        featureDir: state.featureDir,
        runType,
        sessionId: state.runId,
        featureId: state.featureId ?? null,
        category,
      });
    } catch (e) {
      this.appendMetricError(state, `timer-start:${phase}`, e);
    }
  }

  private safeMetricsTimerStop(state: ExecutionState, phase: string): void {
    if (!this.isMetricsEnabled(state)) return;
    const category = phaseToCategory(phase);
    if (!category) return;
    const runType = this.runTypeOf(state);
    try {
      this.deps.metricsReporter?.stopTimer({
        projectRoot: state.projectRoot,
        featureDir: state.featureDir,
        runType,
        sessionId: state.runId,
        featureId: state.featureId ?? null,
        category,
      });
    } catch (e) {
      this.appendMetricError(state, `timer-stop:${phase}`, e);
    }
  }

  private async safeMetricsFinish(state: ExecutionState): Promise<void> {
    if (!this.isMetricsEnabled(state)) return;
    if (state.status !== 'completed') {
      // Per design: only COMPLETED runs report. blocked/aborted/failed
      // are out of scope for the adoption KPI.
      return;
    }
    const reporter = this.deps.metricsReporter;
    if (!reporter) return;
    const runType = this.runTypeOf(state);
    const bugId = state.bugDescription ? deriveBugIdFromDescription(state.bugDescription) : null;
    try {
      // Call the method through the reporter object reference, NOT
      // through a destructured alias. `const fn = reporter.finishRun;
      // fn(args)` would lose `this` and the real reporter would throw
      // `Cannot read properties of undefined (reading 'cfg')` at
      // runtime. Direct `reporter.finishRun(args)` keeps the binding.
      const result = reporter.finishRun({
        projectRoot: state.projectRoot,
        featureDir: state.featureDir,
        runType,
        sessionId: state.runId,
        featureId: state.featureId ?? null,
        ...(bugId ? { bugId } : {}),
      });
      // Always await the finishRun promise. The tool layer awaits
      // onRunEnd, so this resolves before the run's HTTP response
      // goes back to the harness, and any retry/queue side effect
      // is durable on disk before the tool exits.
      await result;
    } catch (e) {
      this.appendMetricError(state, 'finish', e);
    }
  }

  /**
   * For an orchestrator workflow like `mrd-to-code`, the "active" workflow
   * is whichever sub-workflow is currently dispatching (state.activeWorkflow).
   * For everything else, the workflow itself is the run-type source. We use
   * this when picking `runType` for the reporter so an `mrd-to-code` run
   * that includes a code-gen-tdd sub-flow still classifies as `code_gen`.
   */
  private runTypeOf(state: ExecutionState): 'code_gen' | 'bugfix' {
    const effective: WorkflowId = state.workflow === 'mrd-to-code' && state.activeWorkflow
      ? state.activeWorkflow
      : state.workflow;
    return effective === 'bugfix' ? 'bugfix' : 'code_gen';
  }

  private isMetricsEnabled(state: ExecutionState): boolean {
    if (!this.deps.metricsReporter) return false;
    // mrd-to-code is an orchestrator. The metrics run is owned by the
    // orchestrator, NOT by the dispatched sub-workflow: the Run Start
    // hook fires before any sub-workflow dispatches, with
    // state.workflow === 'mrd-to-code' and state.activeWorkflow set
    // to the first sub-workflow (e.g. 'implementation-plan'). If we
    // gated on the allowList here, the very first lifecycle.onRunStart
    // would skip the reporter and the sub-workflow's later timer
    // hooks would fail with "feature-dev metrics run has not been
    // started" because the state file was never written.
    //
    // Always enable mrd-to-code so the baseline snapshot is taken at
    // the real start of the run, and timer hooks (gated separately on
    // phaseToCategory) only fire for code-writing phases regardless
    // of which sub-workflow dispatched them.
    if (state.workflow === 'mrd-to-code') return true;
    if (this.deps.metricsWorkflows && this.deps.metricsWorkflows.size > 0) {
      return this.deps.metricsWorkflows.has(state.workflow);
    }
    return state.workflow === 'code-gen-tdd' || state.workflow === 'bugfix';
  }

  private appendMetricError(state: ExecutionState, kind: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    state.notes = (state.notes ?? []).concat(`metrics:${kind}:${message}`);
  }
}

/**
 * Map a workflow phase name to the metrics category the reporter
 * uses for the timer. Phases that don't count as "code writing"
 * (e.g. PHASE1_TEST_SPEC, PHASE6_SUMMARY) return null and the
 * reporter skips the timer entirely.
 */
export function phaseToCategory(phase: string): MetricsCategory | null {
  switch (phase) {
    case 'PHASE2_IMPLEMENTATION':
    case 'PHASE2_REPAIR':
    case 'LOCATE':
    case 'FIX':
      return 'implementation';
    case 'PHASE4_TEST_GENERATION':
    case 'PHASE4_REPAIR':
    case 'TEST_CODE_GEN':
      return 'test_generation';
    default:
      return null;
  }
}

/**
 * Produce a stable, anonymised bug id from the free-form `bugDescription`
 * stored on the run state. We don't want to ship the user's prose
 * through the protocol — both for privacy and payload size — so we
 * hash it. The format `bug-<8 hex>` matches what the original
 * `feature-dev` client emits when the user did not pass an explicit
 * `--bug-id` and the bugfix Beads hook auto-allocated one.
 */
export function deriveBugIdFromDescription(description: string | null | undefined): string {
  const text = String(description || '').trim();
  if (!text) return 'bug-00000000';
  return `bug-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)}`;
}
