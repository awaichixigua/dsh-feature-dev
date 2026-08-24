/**
 * Domain contracts — the types that flow between the boundary
 * (Skill / Tool / Subagent / Workflow / State).
 *
 * Every public-facing JSON shape has a sibling in /schemas and is
 * also exported here as a TypeScript type. The Schema is the
 * source of truth for wire format; the type here is a strict
 * ergonomic mirror.
 *
 * Implementation rule: code MUST NOT take a `string` of user input
 * once it has crossed a boundary. The only string handling allowed
 * is inside Invocation Normalizer.
 */

/** All workflows the bundle knows about. */
export type WorkflowId =
  | 'mrd-to-code'
  | 'knowledge-base'
  | 'implementation-plan'
  | 'code-gen-tdd'
  | 'bugfix'
  | 'archive'
  | 'prd-clarify'
  | 'influence-menu';

/** What the user or a Skill emits to a Tool. */
export interface FeatureDevInvocation {
  workflow: WorkflowId;
  projectRoot: string;
  featureDir?: string;
  featureId?: string;
  /** Stop after reaching this target. e.g. "prd" | "tech" | "phase3" | "code" */
  target?: string;
  /** For MRD flow: the MRDoc share URL or local path. */
  mrdUrl?: string;
  /** For bugfix flow: the user-supplied bug description. */
  bugDescription?: string;
  /** Optional numeric bugfix case id, e.g. `13`. */
  bugCaseId?: string;
  /** Original user request, preserved for audit / display. */
  rawUserRequest?: string;
  options: InvocationOptions;
  /** Optional model role overrides for this run. */
  modelOverrides?: Partial<Record<ModelRole, ModelRoute>>;
}

export interface InvocationOptions {
  resume: boolean;
  /** Whether test generation and execution are enabled for this run. */
  unitTests: boolean;
  /** Command-facing inverse of unitTests; false explicitly enables tests. */
  skipUnitTests?: boolean;
  generateUnitTestsOnly: boolean;
  clarifyMode?: 'dialogue' | 'batch';
  /** Skip the MRD clarification dialogue (already answered elsewhere). */
  skipMrdClarify?: boolean;
  /** Run only a single named phase (advanced; mostly for testing). */
  singlePhase?: string;
}

export type ModelRole = 'planning' | 'coding' | 'review' | 'summary';

export interface ModelRoute {
  provider: string;
  model: string;
}

/** Request sent from Workflow to a Subagent. */
export interface PhaseRequest {
  runId: string;
  workflow: WorkflowId;
  phase: string;
  projectRoot: string;
  featureDir?: string;
  featureId?: string;
  /** Path to a prompt template (resolved inside the bundle's resourceBase). */
  promptPath: string;
  /** Inputs handed to the prompt. */
  inputs: Record<string, unknown>;
  /** Artifacts the agent is expected to produce. */
  expectedArtifacts: string[];
  /** Execution mode. */
  mode: 'normal' | 'incremental-fix' | 'incremental-review';
  /** Hard ceiling on tokens / tool calls for this phase. */
  budget?: PhaseBudget;
}

export interface PhaseBudget {
  maxTokens?: number;
  maxToolCalls?: number;
  maxWallMs?: number;
}

/** Response sent from Subagent back to Workflow. */
export interface PhaseResult {
  status: 'pass' | 'warn' | 'block' | 'failed';
  summary: string;
  artifacts: string[];
  /** Mandatory when status === 'pass' (at least one verifiable evidence item). */
  evidence: string[];
  changedFiles: string[];
  /** Mandatory when status === 'block' (human-readable unblock condition). */
  blocker?: string;
  /** Optional metrics. */
  metrics?: Record<string, number>;
  /** Set only by bugfix LOCATE to choose the automatic repair branch. */
  bugClassification?: 'code_defect' | 'business_requirement';
  /** Bugfix-only, relative to featureDir: `bugfix/<number>-<slug>`. */
  bugCaseDir?: string;
  /** The main conversation already collected the human confirmation for this phase. */
  gateAlreadyConfirmed?: boolean;
}

/** Phases of the Code Gen TDD state machine (TECH_DESIGN.md §9.3). */
export type CodeGenPhase =
  | 'INITIALIZED'
  | 'PHASE1_TEST_SPEC'
  | 'AWAITING_TEST_SPEC_CONFIRMATION'
  | 'PHASE2_IMPLEMENTATION'
  | 'PHASE3_REVIEW'
  | 'PHASE4_TEST_GENERATION'
  | 'PHASE5_TEST_EXECUTION'
  | 'PHASE6_SUMMARY'
  | 'PHASE2_REPAIR'
  | 'PHASE3_REVIEW'
  | 'PHASE4_REPAIR'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'INTERRUPTED';

/** Top-level execution state (machine-authoritative). */
export interface ExecutionState {
  schemaVersion: '1.0.0';
  runId: string;
  /**
   * The workflow whose state machine owns the run. For orchestrator
   * workflows (mrd-to-code) this stays at the orchestrator id
   * throughout; the *currently active sub-workflow* is `activeWorkflow`.
   */
  workflow: WorkflowId;
  /**
   * For orchestrator workflows: the sub-workflow currently being driven.
   * undefined for plain (non-orchestrated) workflows, in which case
   * `workflow` is the only one that runs.
   */
  activeWorkflow?: WorkflowId;
  /**
   * The orchestrator's own workflow id. Set when `workflow` is
   * `mrd-to-code` (or any future orchestrator). Lets the runner
   * reconstruct the orchestration identity after a sub-workflow
   * finishes and writes its own `state.workflow = '<sub>'`.
   */
  orchestratorWorkflow?: WorkflowId;
  projectRoot: string;
  featureDir: string;
  featureId?: string;
  /** Persisted bug context so a blocked LOCATE phase can be resumed safely. */
  bugDescription?: string;
  /** Persisted LOCATE routing decision; survives retries after doc edits fail. */
  bugClassification?: 'code_defect' | 'business_requirement';
  /** Persisted target directory for this bug's reports, relative to featureDir. */
  bugCaseDir?: string;
  /** Whether this run should generate and execute unit tests; survives resume. */
  unitTestsRequested?: boolean;
  currentPhase: string;
  phaseHistory: PhaseHistoryEntry[];
  startedAt: string;
  updatedAt: string;
  status: 'running' | 'paused' | 'completed' | 'blocked' | 'interrupted' | 'failed' | 'aborted';
  /** Repair attempts used so far (any flavor). */
  repairCount: number;
  /** Total subagents spawned so far. */
  agentCount: number;
  /** Pending confirmation gates (user must respond). */
  pendingConfirmations: PendingConfirmation[];
  /** Work that must be completed by the main conversation before resume. */
  pendingMainAction?: PendingMainAction;
  /** Last PhaseResult for the current phase. */
  lastPhaseResult?: PhaseResult;
  /** Per-feature model role overrides. */
  modelOverrides?: Partial<Record<ModelRole, ModelRoute>>;
  /** Free-form notes (audit only; never read for state recovery). */
  notes?: string[];
}

export type PendingMainAction = ClarifyMrdMainAction | RouteServicesMainAction;

export interface ClarifyMrdMainAction {
  kind: 'clarify_mrd';
  mode: 'dialogue' | 'batch';
  mrdOriginalPath: string;
  mrdClarifiedPath: string;
  knowledgeBasePath?: string;
  instruction: string;
}

/** Service routing could not determine writable repositories from the MRD. */
export interface RouteServicesMainAction {
  kind: 'route_services';
  mrdOriginalPath: string;
  appsPath: string;
  routeSnapshot?: Record<string, unknown>;
  instruction: string;
}

export interface PhaseHistoryEntry {
  phase: string;
  status: PhaseResult['status'] | 'pending';
  startedAt: string;
  endedAt?: string;
  summary?: string;
  artifacts?: string[];
}

export interface PendingConfirmation {
  id: string;
  gate: string;
  prompt: string;
  options: string[];
  raisedAt: string;
}

/** Append-only audit event. */
export type RunEvent =
  | { kind: 'run_start'; at: string; runId: string; workflow: WorkflowId }
  | { kind: 'phase_start'; at: string; runId: string; phase: string }
  | { kind: 'phase_end'; at: string; runId: string; phase: string; status: PhaseResult['status'] }
  | { kind: 'gate_raised'; at: string; runId: string; gate: string }
  | { kind: 'gate_resolved'; at: string; runId: string; gate: string; choice: string }
  | { kind: 'run_end'; at: string; runId: string; status: ExecutionState['status'] }
  | { kind: 'repair'; at: string; runId: string; fromPhase: string; toPhase: string; reason: string }
  | { kind: 'tool_call'; at: string; runId: string; tool: string; args: unknown };
