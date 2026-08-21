/**
 * Gate Engine.
 *
 * Gates are the only place where the workflow is allowed to wait for human
 * input. Each gate is described declaratively. The engine never returns
 * until a confirmation is provided or the user is presented with a forced
 * "skip / abort" choice.
 *
 * Gates DO NOT live in the Skill — they live here so the state machine
 * remains the single source of truth even if a UI event is missed.
 */

import type { ExecutionState, PendingConfirmation } from '../types/contracts.js';
import type { StateRepository } from './state-repository.js';

export type Gate =
  | 'post_locate'
  | 'post_service_router'
  | 'pre_test_spec'
  | 'post_test_spec'
  | 'pre_tech_design'
  | 'pre_prd'
  | 'pre_archive'
  | 'pre_kb_update';

export interface GateDef {
  id: Gate;
  prompt: string;
  options: string[];
  required: boolean;
  /** If true, the gate is a blocking confirmation. Otherwise a soft warning. */
  blocking: boolean;
}

export const GATES: Record<Gate, GateDef> = {
  post_locate: {
    id: 'post_locate',
    prompt: '请先确认 LOCATE 阶段的定位结论和建议修复方向，再修改代码或文档。',
    options: ['proceed', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  post_service_router: {
    id: 'post_service_router',
    prompt: '请确认 app-router 识别的服务范围是否正确。请核对 apps.json 中的 primary、collaborators、readOnly 和 repositories；确认后才会为可写服务创建或切换需求分支。',
    options: ['accept', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  pre_test_spec: {
    id: 'pre_test_spec',
    prompt: '请确认测试规格后再开始实现。',
    options: ['proceed', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  post_test_spec: {
    id: 'post_test_spec',
    prompt: '是否按当前测试规格继续？',
    options: ['accept', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  pre_prd: {
    id: 'pre_prd',
    prompt: '是否确认以当前 PRD 作为技术方案的依据？',
    options: ['accept', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  pre_tech_design: {
    id: 'pre_tech_design',
    prompt: '是否确认当前技术方案并进入代码实现？',
    options: ['proceed', 'revise', 'abort'],
    required: true,
    blocking: true,
  },
  pre_archive: {
    id: 'pre_archive',
    prompt: '是否继续归档？',
    options: ['proceed', 'abort'],
    required: true,
    blocking: true,
  },
  pre_kb_update: {
    id: 'pre_kb_update',
    prompt: '是否将新发现更新到知识库？',
    options: ['update', 'skip'],
    required: false,
    blocking: false,
  },
  /* Removed warning gate.
  removed_warning: {
    id: 'removed_warning',
    prompt: '环境诊断发现警告，是否继续？',
    options: ['continue', 'abort'],
    required: true,
    blocking: false,
  },
  */
};

export class GateEngine {
  constructor(
    private readonly repo: StateRepository,
    private readonly strict: boolean
  ) {}

  /** Raise a gate. Returns the pending confirmation (id) the workflow should
   *  hand back to the caller for them to resolve. */
  raise(state: ExecutionState, gate: Gate, customPrompt?: string): PendingConfirmation {
    const def = GATES[gate];
    if (!def) {
      throw new Error(`Unknown gate: ${gate}`);
    }
    if (!this.strict && !def.blocking) {
      // soft gate under non-strict mode: auto-accept, no confirmation needed
      return {
        id: 'auto',
        gate,
        raisedAt: new Date().toISOString(),
        prompt: customPrompt ?? def.prompt,
        options: def.options,
      };
    }
    this.repo.raiseConfirmation(state, {
      gate,
      prompt: customPrompt ?? def.prompt,
      options: def.options,
    });
    if (def.blocking) {
      state.status = 'paused';
      state.updatedAt = new Date().toISOString();
      this.repo.writeAtomicPublic(state);
    }
    return state.pendingConfirmations[state.pendingConfirmations.length - 1]!;
  }

  /** Resolve a previously-raised gate. */
  resolve(state: ExecutionState, gateId: string, choice: string): ExecutionState {
    return this.repo.resolveConfirmation(state, gateId, choice);
  }
}
