/**
 * State Repository.
 *
 * Owns the machine-authoritative JSON state, the append-only event log,
 * and the human-readable Markdown projection. All updates are atomic
 * (write-temp + rename) so a crash never leaves half-written state.
 *
 * Layout (relative to projectRoot):
 *   {featureDir}/ai/current-run.json
 *   {featureDir}/ai/runs/{runId}/execution-state.json
 *   {featureDir}/ai/runs/{runId}/execution-state.md
 *   {featureDir}/ai/runs/{runId}/run-events.jsonl
 *
 * The repository DOES NOT re-parse Markdown. The Markdown is generated,
 * not consumed. State recovery always reads JSON.
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ExecutionState,
  PendingConfirmation,
  PhaseHistoryEntry,
  PhaseResult,
  RunEvent,
  WorkflowId,
} from '../types/contracts.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { getInitialPhase, getTerminalPhases } from './state-machine.js';

const SCHEMA_VERSION = '1.0.0' as const;
const DEFAULT_STATE_SUBDIR = 'ai';

export interface StateRepositoryOptions {
  projectRoot: string;
  featureDir: string;
  stateSubdir?: string;
  runId?: string;
}

interface CurrentRunPointer {
  schemaVersion: '1.0.0';
  runId: string;
  workflow: WorkflowId;
  updatedAt: string;
}

export class StateRepository {
  readonly aiDir: string;
  readonly runsDir: string;
  readonly currentRunPath: string;
  private boundRunId?: string;

  constructor(opts: StateRepositoryOptions) {
    if (!opts.projectRoot || !opts.featureDir) {
      throw new ValidationError('StateRepository requires projectRoot and featureDir');
    }
    const sub = opts.stateSubdir ?? DEFAULT_STATE_SUBDIR;
    this.aiDir = resolve(opts.featureDir, sub);
    this.runsDir = resolve(this.aiDir, 'runs');
    this.currentRunPath = resolve(this.aiDir, 'current-run.json');
    this.migrateLegacyLayout();
    const selectedRunId = opts.runId ?? this.readCurrentRunId() ?? this.findLatestRunId();
    if (selectedRunId) this.bindRun(selectedRunId);
    if (!opts.runId && selectedRunId && !existsSync(this.currentRunPath) && this.exists()) {
      this.activateRunPublic(this.read());
    }
  }

  get runId(): string | undefined {
    return this.boundRunId;
  }

  get runDir(): string {
    return this.boundRunId ? resolve(this.runsDir, this.boundRunId) : resolve(this.runsDir, '_unbound');
  }

  get statePath(): string {
    return resolve(this.runDir, 'execution-state.json');
  }

  get eventsPath(): string {
    return resolve(this.runDir, 'run-events.jsonl');
  }

  get mdPath(): string {
    return resolve(this.runDir, 'execution-state.md');
  }

  ensureLayout(): void {
    if (!existsSync(this.aiDir)) {
      mkdirSync(this.aiDir, { recursive: true });
    }
    if (!existsSync(this.runsDir)) {
      mkdirSync(this.runsDir, { recursive: true });
    }
  }

  exists(): boolean {
    return Boolean(this.boundRunId) && existsSync(this.statePath);
  }

  /** Read current state. Throws NotFoundError if missing. */
  read(): ExecutionState {
    if (!this.exists()) {
      throw new NotFoundError('execution-state.json not found', { path: this.statePath });
    }
    const raw = readFileSync(this.statePath, 'utf8');
    const parsed = JSON.parse(raw) as ExecutionState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      throw new ConflictError('Incompatible execution-state.json schemaVersion', {
        found: parsed.schemaVersion,
        expected: SCHEMA_VERSION,
      });
    }
    return parsed;
  }

  /** Create a fresh state. Fails if one already exists (use loadOrCreate to recover). */
  create(args: {
    runId?: string;
    workflow: WorkflowId;
    projectRoot: string;
    featureDir: string;
    featureId?: string;
    bugDescription?: string;
    bugCaseDir?: string;
    unitTestsRequested?: boolean;
    modelOverrides?: ExecutionState['modelOverrides'];
    /** Orchestrator workflows (mrd-to-code) set this so the runner can
     *  restore the orchestration identity after a sub-workflow
     *  finishes and overwrites state.workflow. */
    orchestratorWorkflow?: WorkflowId;
    /** Orchestrator workflows set this to the sub-workflow currently
     *  being driven. Undefined for plain (non-orchestrated) workflows. */
    activeWorkflow?: WorkflowId;
  }): ExecutionState {
    this.ensureLayout();
    this.bindRun(args.runId ?? randomUUID());
    if (this.exists()) {
      throw new ConflictError('execution-state.json already exists; refusing to overwrite', {
        path: this.statePath,
      });
    }
    const now = new Date().toISOString();
    const state: ExecutionState = {
      schemaVersion: SCHEMA_VERSION,
      runId: this.boundRunId!,
      workflow: args.workflow,
      activeWorkflow: args.activeWorkflow,
      orchestratorWorkflow: args.orchestratorWorkflow,
      projectRoot: args.projectRoot,
      featureDir: args.featureDir,
      featureId: args.featureId,
      bugDescription: args.bugDescription,
      bugCaseDir: args.bugCaseDir,
      unitTestsRequested: args.unitTestsRequested,
      currentPhase: getInitialPhase(args.activeWorkflow ?? args.workflow),
      phaseHistory: [],
      startedAt: now,
      updatedAt: now,
      status: 'running',
      repairCount: 0,
      agentCount: 0,
      pendingConfirmations: [],
      modelOverrides: args.modelOverrides,
    };
    this.writeAtomic(state);
    this.appendEvent({ kind: 'run_start', at: now, runId: state.runId, workflow: args.workflow });
    this.regenerateMarkdown(state);
    this.activateRunPublic(state);
    return state;
  }

  /** Load existing state or create a new one. */
  loadOrCreate(args: {
    runId?: string;
    workflow: WorkflowId;
    projectRoot: string;
    featureDir: string;
    featureId?: string;
    bugDescription?: string;
    bugCaseDir?: string;
    unitTestsRequested?: boolean;
    modelOverrides?: ExecutionState['modelOverrides'];
    orchestratorWorkflow?: WorkflowId;
    activeWorkflow?: WorkflowId;
  }): { state: ExecutionState; created: boolean } {
    if (this.exists()) {
      const s = this.read();
      // Versions before 0.1.0 could advance a blocked linear workflow all the
      // way to COMPLETED. Such a state is internally impossible: its terminal
      // phase says COMPLETED while its last result is block/failed. Preserve an
      // exact snapshot, then treat an explicit new `run` call as a fresh run.
      if (isLegacyFalseCompletion(s, args.workflow)) {
        const previousPath = this.statePath;
        const recovered = this.create(args);
        recovered.notes = [`Recovered legacy false completion; previous state: ${previousPath}`];
        this.writeAtomic(recovered);
        this.regenerateMarkdown(recovered);
        return { state: recovered, created: true };
      }
      // `feature_dev_run` after a terminal state creates a fresh run directory.
      // The completed run remains immutable and queryable by runId.
      if (isTerminalStatus(s.status)) {
        return { state: this.create(args), created: true };
      }
      if (s.workflow !== args.workflow) {
        throw new ConflictError('A different workflow is already active for this feature', {
          activeRunId: s.runId,
          activeWorkflow: s.workflow,
          requestedWorkflow: args.workflow,
        });
      }
      // Pending confirmation gates MUST be resolved before any
      // `run` / `resume` action advances the workflow. Without
      // this guard, calling `feature_dev_resume` while a gate is
      // open would silently skip the gate and roll the workflow
      // forward — which is exactly the bug we hit in the
      // gate-bypass integration test.
      if (s.pendingConfirmations.length > 0) {
        throw new ConflictError(
          'Run has pending confirmation(s); resolve them via feature_dev_confirm before re-running',
          {
            runId: s.runId,
            pendingConfirmations: s.pendingConfirmations.map((c) => ({
              id: c.id,
              gate: c.gate,
              options: c.options,
            })),
          }
        );
      }
      // A repeated `run` call carries the full user input and is a valid retry
      // path for a blocked run. Persist missing context before rewinding so the
      // subsequent resume path never loses the original bug description.
      if (args.bugDescription) s.bugDescription = args.bugDescription;
      if (args.unitTestsRequested !== undefined) {
        s.unitTestsRequested = args.unitTestsRequested;
      }
      if (args.workflow === 'bugfix') {
        if (args.bugCaseDir) s.bugCaseDir = args.bugCaseDir;
      }
      if (s.status === 'blocked') {
        rewindMostRecentFailure(s);
      }
      s.status = 'running';
      s.updatedAt = new Date().toISOString();
      this.writeAtomic(s);
      return { state: s, created: false };
    }
    return { state: this.create(args), created: true };
  }

  /** Begin a phase. Records into history and bumps updatedAt. */
  beginPhase(state: ExecutionState, phase: string): ExecutionState {
    if (state.status === 'completed' || state.status === 'blocked') {
      throw new ConflictError(`Cannot begin phase while run is ${state.status}`, {
        status: state.status,
        phase,
      });
    }
    state.currentPhase = phase;
    state.updatedAt = new Date().toISOString();
    state.phaseHistory.push({
      phase,
      status: 'pending',
      startedAt: state.updatedAt,
    });
    this.writeAtomic(state);
    this.appendEvent({
      kind: 'phase_start',
      at: state.updatedAt,
      runId: state.runId,
      phase,
    });
    return state;
  }

  /** End a phase. Updates history entry, sets lastPhaseResult, regenerates MD. */
  endPhase(state: ExecutionState, phase: string, result: PhaseResult): ExecutionState {
    const entry = lastEntry(state.phaseHistory, phase);
    if (!entry) {
      throw new ConflictError('beginPhase() must be called before endPhase()', { phase });
    }
    entry.status = result.status;
    entry.endedAt = new Date().toISOString();
    entry.summary = result.summary;
    entry.artifacts = result.artifacts;
    state.lastPhaseResult = result;
    if (result.status === 'pass' || result.status === 'warn') {
      // no counter bump on pass; only on repair
    } else if (result.status === 'block') {
      // don't bump repairCount here — the caller (workflow) decides if a
      // repair transition is actually taken.
    }
    state.updatedAt = entry.endedAt;
    this.writeAtomic(state);
    this.appendEvent({
      kind: 'phase_end',
      at: state.updatedAt,
      runId: state.runId,
      phase,
      status: result.status,
    });
    this.regenerateMarkdown(state);
    return state;
  }

  /** Move the current phase to a new one. Does NOT run begin/end bookkeeping —
   *  use this for the bookkeeping-free transitions (e.g. COMPLETED).
   *
   * Only writes the `run_end` event when the transition reaches a real
   * terminal status. Sub-workflow internal transitions (e.g. moving
   * from PHASE1 to PHASE2 inside code-gen-tdd) MUST NOT emit `run_end`,
   * otherwise the event log gets multiple "run ended" entries for one
   * logical run — and any tool that counts end events breaks. */
  transition(state: ExecutionState, toPhase: string): ExecutionState {
    state.currentPhase = toPhase;
    state.updatedAt = new Date().toISOString();
    // A completed sub-workflow is not the end of an orchestrated run.
    if (toPhase === 'COMPLETED') {
      state.status = state.orchestratorWorkflow && state.activeWorkflow
        ? 'running'
        : 'completed';
    }
    if (toPhase === 'BLOCKED') state.status = 'blocked';
    if (toPhase === 'INTERRUPTED') state.status = 'interrupted';
    // 'ABORTED' is only set by the confirm tool, not by transitions.
    this.writeAtomic(state);
    if (this.isTerminalTransition(toPhase, state.status)) {
      this.appendEvent({
        kind: 'run_end',
        at: state.updatedAt,
        runId: state.runId,
        status: state.status,
      });
    }
    this.regenerateMarkdown(state);
    return state;
  }

  private isTerminalTransition(toPhase: string, status: ExecutionState['status']): boolean {
    // Only truly terminal states write run_end. BLOCKED and
    // INTERRUPTED are recoverable — the user can `feature_dev_resume`
    // and the run continues. Writing a run_end on every BLOCKED
    // transition would produce N "run ended" events per run.
    if (toPhase === 'COMPLETED' && status === 'completed') return true;
    if (status === 'aborted') return true;
    if (status === 'failed') return true;
    return false;
  }

  bumpRepair(state: ExecutionState, fromPhase: string, toPhase: string, reason: string): ExecutionState {
    state.repairCount += 1;
    state.updatedAt = new Date().toISOString();
    this.writeAtomic(state);
    this.appendEvent({
      kind: 'repair',
      at: state.updatedAt,
      runId: state.runId,
      fromPhase,
      toPhase,
      reason,
    });
    return state;
  }

  raiseConfirmation(state: ExecutionState, conf: Omit<PendingConfirmation, 'id' | 'raisedAt'>): ExecutionState {
    const id = randomUUID();
    const full: PendingConfirmation = {
      id,
      raisedAt: new Date().toISOString(),
      ...conf,
    };
    state.pendingConfirmations.push(full);
    state.updatedAt = full.raisedAt;
    this.writeAtomic(state);
    this.appendEvent({
      kind: 'gate_raised',
      at: full.raisedAt,
      runId: state.runId,
      gate: conf.gate,
    });
    return state;
  }

  resolveConfirmation(state: ExecutionState, gateId: string, choice: string): ExecutionState {
    const idx = state.pendingConfirmations.findIndex((c) => c.id === gateId);
    if (idx < 0) {
      throw new NotFoundError('Pending confirmation not found', { gateId });
    }
    state.pendingConfirmations.splice(idx, 1);
    state.updatedAt = new Date().toISOString();
    this.writeAtomic(state);
    this.appendEvent({
      kind: 'gate_resolved',
      at: state.updatedAt,
      runId: state.runId,
      gate: gateId,
      choice,
    });
    return state;
  }

  recordToolCall(state: ExecutionState, tool: string, args: unknown): void {
    this.appendEvent({
      kind: 'tool_call',
      at: new Date().toISOString(),
      runId: state.runId,
      tool,
      args,
    });
  }

  /**
   * Public: append a free-form event. Used by tools that need to
   * record their own state changes (e.g. confirm rewinding).
   */
  appendEventPublic(event: RunEvent): void {
    this.appendEvent(event);
  }

  /**
   * Public write of the state file. The same as the private writeAtomic
   * but exposed for tools that mutate state outside the standard
   * phase lifecycle (e.g. confirm rewinding).
   */
  writeAtomicPublic(state: ExecutionState): void {
    this.bindRun(state.runId);
    this.writeAtomic(state);
  }

  /** Atomically make a run the default target for status/resume/confirm. */
  activateRunPublic(state: ExecutionState): void {
    this.bindRun(state.runId);
    this.ensureLayout();
    const pointer: CurrentRunPointer = {
      schemaVersion: SCHEMA_VERSION,
      runId: state.runId,
      workflow: state.workflow,
      updatedAt: state.updatedAt,
    };
    const tmp = this.currentRunPath + '.tmp-' + process.pid;
    writeFileSync(tmp, JSON.stringify(pointer, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.currentRunPath);
  }

  /** Rebuild the human-readable state projection after a repository move. */
  regenerateMarkdownPublic(state: ExecutionState): void {
    this.regenerateMarkdown(state);
  }

  // ---- internals ---------------------------------------------------------

  private writeAtomic(state: ExecutionState): void {
    this.bindRun(state.runId);
    this.ensureLayout();
    if (!existsSync(this.runDir)) mkdirSync(this.runDir, { recursive: true });
    const json = JSON.stringify(state, null, 2) + '\n';
    const tmp = this.statePath + '.tmp-' + process.pid;
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, this.statePath);
    if (this.readCurrentRunId() === state.runId) {
      this.activateRunPublic(state);
    }
  }

  private bindRun(runId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
      throw new ValidationError('Invalid runId', { runId });
    }
    this.boundRunId = runId;
  }

  private readCurrentRunId(): string | undefined {
    if (!existsSync(this.currentRunPath)) return undefined;
    try {
      const value = JSON.parse(readFileSync(this.currentRunPath, 'utf8')) as Partial<CurrentRunPointer>;
      return typeof value.runId === 'string' && value.runId.length > 0 ? value.runId : undefined;
    } catch {
      return undefined;
    }
  }

  private findLatestRunId(): string | undefined {
    if (!existsSync(this.runsDir)) return undefined;
    const candidates: Array<{ runId: string; mtime: number }> = [];
    for (const entry of readdirSync(this.runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statePath = resolve(this.runsDir, entry.name, 'execution-state.json');
      if (!existsSync(statePath)) continue;
      try {
        candidates.push({ runId: entry.name, mtime: statSync(statePath).mtimeMs });
      } catch {
        // Ignore incomplete or unreadable orphan directories.
      }
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.runId;
  }

  /** Copy the legacy flat files into a run directory, then publish the pointer. */
  private migrateLegacyLayout(): void {
    if (existsSync(this.currentRunPath)) return;
    const legacyStatePath = resolve(this.aiDir, 'execution-state.json');
    if (!existsSync(legacyStatePath)) return;
    let state: ExecutionState;
    try {
      state = JSON.parse(readFileSync(legacyStatePath, 'utf8')) as ExecutionState;
      this.bindRun(state.runId);
    } catch {
      return;
    }
    this.ensureLayout();
    if (!existsSync(this.runDir)) mkdirSync(this.runDir, { recursive: true });
    const files: Array<[string, string]> = [
      [legacyStatePath, this.statePath],
      [resolve(this.aiDir, 'execution-state.md'), this.mdPath],
      [resolve(this.aiDir, 'run-events.jsonl'), this.eventsPath],
    ];
    for (const [source, target] of files) {
      if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
    }
    this.activateRunPublic(state);
  }

  private appendEvent(event: RunEvent): void {
    this.ensureLayout();
    appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', 'utf8');
  }

  /** Render the human-readable Markdown projection. */
  private regenerateMarkdown(state: ExecutionState): void {
    const lines: string[] = [];
    lines.push(`# Feature Dev Run — ${state.workflow}`);
    lines.push('');
    lines.push(`- **运行 ID**: \`${state.runId}\``);
    lines.push(`- **需求目录**: \`${state.featureDir}\`${state.featureId ? ` (${state.featureId})` : ''}`);
    lines.push(`- **项目**: \`${state.projectRoot}\``);
    lines.push(`- **状态**: \`${state.status}\``);
    lines.push(`- **当前阶段**: \`${state.currentPhase}\``);
    lines.push(`- **开始时间**: ${state.startedAt}`);
    lines.push(`- **更新时间**: ${state.updatedAt}`);
    lines.push(`- **修复尝试次数**: ${state.repairCount} /（配置上限）`);
    lines.push(`- **已启动子代理数**: ${state.agentCount}`);
    lines.push('');
    if (state.pendingMainAction) {
      lines.push('## 主会话待办');
      lines.push('');
      lines.push(`- **类型**: \`${state.pendingMainAction.kind}\``);
      lines.push(`- **说明**: ${state.pendingMainAction.instruction}`);
      lines.push(`- **MRD 输入**: \`${state.pendingMainAction.mrdOriginalPath}\``);
      if (state.pendingMainAction.kind === 'clarify_mrd') {
        lines.push(`- **澄清输出**: \`${state.pendingMainAction.mrdClarifiedPath}\``);
        if (state.pendingMainAction.knowledgeBasePath) {
          lines.push(`- **知识库**: \`${state.pendingMainAction.knowledgeBasePath}\``);
        }
      } else {
        lines.push(`- **服务路由输出**: \`${state.pendingMainAction.appsPath}\``);
      }
      lines.push('');
    }
    if (state.lastPhaseResult) {
      lines.push('## 最近阶段结果');
      lines.push('');
      lines.push(`- **状态**: \`${state.lastPhaseResult.status}\``);
      lines.push(`- **摘要**: ${state.lastPhaseResult.summary}`);
      if (state.lastPhaseResult.artifacts.length > 0) {
        lines.push(`- **产物**:`);
        for (const a of state.lastPhaseResult.artifacts) lines.push(`  - ${a}`);
      }
      if (state.lastPhaseResult.changedFiles.length > 0) {
        lines.push(`- **已修改文件**:`);
        for (const c of state.lastPhaseResult.changedFiles) lines.push(`  - ${c}`);
      }
      if (state.lastPhaseResult.blocker) {
        lines.push(`- **阻塞原因**: ${state.lastPhaseResult.blocker}`);
      }
      lines.push('');
    }
    if (state.pendingConfirmations.length > 0) {
      lines.push('## 待确认事项');
      lines.push('');
      for (const c of state.pendingConfirmations) {
        lines.push(`- **[${c.gate}]** (${c.raisedAt})`);
        lines.push(`  ${c.prompt}`);
        if (c.options.length > 0) {
          lines.push(`  可选项: ${c.options.join(' | ')}`);
        }
      }
      lines.push('');
    }
    if (state.phaseHistory.length > 0) {
      lines.push('## 阶段历史');
      lines.push('');
      lines.push('| 阶段 | 状态 | 开始时间 | 结束时间 | 摘要 |');
      lines.push('|---|---|---|---|---|');
      for (const h of state.phaseHistory) {
        lines.push(
          `| \`${h.phase}\` | \`${h.status}\` | ${h.startedAt} | ${h.endedAt ?? ''} | ${(h.summary ?? '').replace(/\|/g, '\\|').slice(0, 120)} |`
        );
      }
      lines.push('');
    }
    const terminals = getTerminalPhases(state.workflow);
    if (terminals.includes(state.currentPhase)) {
      lines.push('## 结束状态');
      lines.push('');
      lines.push(`运行结束于 \`${state.currentPhase}\`。`);
      lines.push('');
    }
    const tmp = this.mdPath + '.tmp-' + process.pid;
    writeFileSync(tmp, lines.join('\n'), 'utf8');
    renameSync(tmp, this.mdPath);
  }
}

function lastEntry(history: PhaseHistoryEntry[], phase: string): PhaseHistoryEntry | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.phase === phase) return history[i];
  }
  return undefined;
}

/**
 * Statuses from which an automatic resume would mutate the user's
 * decision. `aborted` and `failed` are deliberately treated as
 * terminal here: resuming an aborted run would silently undo the
 * user's choice. `failed` is reserved for unrecoverable infrastructure
 * failures; the user must start a new run.
 */
export function isTerminalStatus(s: ExecutionState['status']): boolean {
  return s === 'completed' || s === 'aborted' || s === 'failed';
}

/** Detect the impossible terminal shape written by the old linear driver. */
export function isLegacyFalseCompletion(
  state: ExecutionState,
  requestedWorkflow: WorkflowId
): boolean {
  if (
    state.workflow !== requestedWorkflow
    || state.status !== 'completed'
    || state.currentPhase !== 'COMPLETED'
  ) {
    return false;
  }
  const lastStatus = state.lastPhaseResult?.status
    ?? state.phaseHistory[state.phaseHistory.length - 1]?.status;
  return lastStatus === 'block' || lastStatus === 'failed';
}

/** Re-run the phase that most recently returned block/failed. */
export function rewindMostRecentFailure(state: ExecutionState): void {
  let failedIndex = -1;
  for (let index = state.phaseHistory.length - 1; index >= 0; index -= 1) {
    const status = state.phaseHistory[index]!.status;
    if (status === 'block' || status === 'failed') {
      failedIndex = index;
      break;
    }
  }
  if (failedIndex >= 0) {
    state.phaseHistory = state.phaseHistory.slice(0, failedIndex);
  }
  const previous = state.phaseHistory[state.phaseHistory.length - 1];
  state.currentPhase = previous?.phase ?? 'INITIALIZED';
  state.lastPhaseResult = undefined;
  state.status = 'running';
  state.updatedAt = new Date().toISOString();
}
