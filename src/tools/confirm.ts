/**
 * `feature_dev_confirm` �?resolve a pending confirmation gate.
 *
 * Choice semantics:
 *
 *   accept    / proceed  �?clear the gate. The next resume continues
 *                          from the current phase. (Use case: PRD signed off.)
 *   revise    �?clear the gate AND rewind the state machine to the
 *               phase that raised the gate so a fresh attempt can
 *               produce a better artifact. (Use case: revise PRD before
 *               tech design runs.)
 *   abort     �?set run status to `aborted`, transition to BLOCKED.
 *               The run is no longer auto-resumable; a new run must
 *               be started. (Use case: cancel the feature entirely.)
 *   continue  / skip / update �?soft-gate acknowledgement. Clear the
 *               gate; the workflow proceeds without rewinding.
 *
 * The choice MUST be among the gate's offered options.
 */

import { shape, ok, fail, type ToolContext, type ToolResult } from './contract.js';
import { StateRepository } from '../runtime/state-repository.js';
import { resolveProjectRoot, validateFeatureDir } from '../runtime/paths.js';
import { GateEngine } from '../runtime/gate-engine.js';
import { NotFoundError, ValidationError } from '../runtime/errors.js';
import type { Gate } from '../runtime/gate-engine.js';
import type { PhaseHistoryEntry } from '../types/contracts.js';

export interface ConfirmArgs {
  projectRoot: string;
  featureDir: string;
  /** Which gate to resolve. If absent, resolve the first pending. */
  gateId?: string;
  gate?: Gate;
  choice: string;
}

export interface ConfirmOutput {
  runId: string;
  resolvedGate: string;
  choice: string;
  remainingPending: number;
  /** Side-effect: what changed about the run. */
  action: 'continue' | 'rewind' | 'abort' | 'soft';
}

const SOFT_CHOICES = new Set(['continue', 'skip', 'update']);
const REWIND_CHOICES = new Set(['revise']);
const ABORT_CHOICES = new Set(['abort']);
const ACCEPT_CHOICES = new Set(['accept', 'proceed']);

/** Map a gate name to the phase that raised it. */
const GATE_TO_PHASE: Record<string, string> = {
  post_locate: 'LOCATE',
  post_service_router: 'SERVICE_ROUTER',
  pre_prd: 'PRD',
  post_test_spec: 'PHASE1_TEST_SPEC',
  pre_tech_design: 'TECH_DESIGN',
  pre_archive: 'SNAPSHOT',
  pre_kb_update: 'KB_UPDATE',
};

function gateToPhase(gate: string, _state: import('../types/contracts.js').ExecutionState): string | undefined {
  return GATE_TO_PHASE[gate];
}

export async function confirmFeatureDev(
  _ctx: ToolContext,
  rawArgs: unknown
): Promise<ToolResult<ConfirmOutput>> {
  try {
    const args = shape<ConfirmArgs>(rawArgs, {
      projectRoot: 'string',
      featureDir: 'string',
      choice: 'string',
    });
    const projectRoot = resolveProjectRoot({ explicit: args.projectRoot });
    const featureDir = validateFeatureDir(args.featureDir, projectRoot);
    const repo = new StateRepository({ projectRoot, featureDir });
    if (!repo.exists()) {
      throw new NotFoundError('No execution-state.json', { path: repo.statePath });
    }
    const state = repo.read();
    const engine = new GateEngine(repo, true);

    let target: string | undefined = args.gateId;
    if (!target) {
      if (!args.gate) {
        throw new ValidationError('Either gateId or gate must be provided');
      }
      const match = state.pendingConfirmations.find((c) => c.gate === args.gate);
      if (!match) {
        throw new NotFoundError('No pending confirmation matches the given gate', { gate: args.gate });
      }
      target = match.id;
    }
    const conf = state.pendingConfirmations.find((c) => c.id === target);
    if (!conf) {
      throw new NotFoundError('Pending confirmation not found', { gateId: target });
    }
    if (!conf.options.includes(args.choice)) {
      throw new ValidationError('Choice is not among the offered options', {
        choice: args.choice,
        options: conf.options,
      });
    }

    // Classify the choice
    let action: ConfirmOutput['action'];
    if (ABORT_CHOICES.has(args.choice)) {
      action = 'abort';
    } else if (REWIND_CHOICES.has(args.choice)) {
      action = 'rewind';
    } else if (SOFT_CHOICES.has(args.choice)) {
      action = 'soft';
    } else if (ACCEPT_CHOICES.has(args.choice)) {
      action = 'continue';
    } else {
      // Unrecognized choice �?be conservative: treat as soft continue.
      action = 'soft';
    }

    // Always remove the gate from the pending list
    engine.resolve(state, target, args.choice);

    if (action === 'abort') {
      state.status = 'aborted';
      state.updatedAt = new Date().toISOString();
      repo.writeAtomicPublic(state);
      repo.appendEventPublic({
        kind: 'gate_resolved',
        at: state.updatedAt,
        runId: state.runId,
        gate: target,
        choice: `${args.choice}:ABORTED`,
      });
      return finishOk(state, conf.gate, args.choice, 'abort');
    }

    // A blocking gate pauses the run. Every non-abort acknowledgement makes
    // the run resumable again; revise may additionally rewind below.
    state.status = 'running';
    state.updatedAt = new Date().toISOString();
    repo.writeAtomicPublic(state);

    if (action === 'rewind') {
      // Rewind: drop the most recent phase from history (the one that
      // raised the gate) and reset currentPhase to it so the next
      // resume will re-run that phase. Keep the previous history.
      const rewindPhase = gateToPhase(conf.gate, state);
      if (rewindPhase) {
        rewindToPhase(state, rewindPhase);
        repo.writeAtomicPublic(state);
        repo.appendEventPublic({
          kind: 'gate_resolved',
          at: state.updatedAt,
          runId: state.runId,
          gate: target,
          choice: `${args.choice}:REWIND_TO:${rewindPhase}`,
        });
      }
    }

    return finishOk(state, conf.gate, args.choice, action);
  } catch (e) {
    return fail(e);
  }
}

function finishOk(
  state: import('../types/contracts.js').ExecutionState,
  resolvedGate: string,
  choice: string,
  action: ConfirmOutput['action']
): ToolResult<ConfirmOutput> {
  return ok({
    runId: state.runId,
    resolvedGate,
    choice,
    remainingPending: state.pendingConfirmations.length,
    action,
  });
}

function lastFinishedPhase(state: import('../types/contracts.js').ExecutionState): string | undefined {
  for (let i = state.phaseHistory.length - 1; i >= 0; i--) {
    const e = state.phaseHistory[i]!;
    if (e.status !== 'pending') return e.phase;
  }
  return state.currentPhase;
}

function rewindToPhase(state: import('../types/contracts.js').ExecutionState, phase: string): void {
  // Drop history entries for `phase` and any subsequent phase. The state
  // machine records the last completed phase, so rewind to the phase before
  // the target; the next resume will then calculate and execute `phase`.
  // NOTE: we DO NOT touch `repairCount` �?a rewind is not a repair.
  const idx = state.phaseHistory.findIndex((h: PhaseHistoryEntry) => h.phase === phase);
  if (idx < 0) {
    state.currentPhase = 'INITIALIZED';
    return;
  }
  state.phaseHistory = state.phaseHistory.slice(0, idx);
  state.currentPhase = state.phaseHistory[state.phaseHistory.length - 1]?.phase ?? 'INITIALIZED';
  state.lastPhaseResult = undefined;
  state.updatedAt = new Date().toISOString();
}
