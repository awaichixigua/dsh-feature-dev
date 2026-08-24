/**
 * Publish the work produced by a completed workflow.
 *
 * This deliberately uses `git add --all`, rather than `git add .`, so newly
 * created files and deletions are part of the same commit. The caller invokes
 * it only after the workflow has reached a completed terminal state.
 */

import { execFileSync } from 'node:child_process';
import type { AutoCommitResult, WorkflowId } from '../types/contracts.js';

export interface AutoCommitInput {
  cwd: string;
  workflow: Extract<WorkflowId, 'implementation-plan' | 'code-gen-tdd' | 'bugfix'>;
  runId: string;
}

export interface GitCommandRunner {
  run(cwd: string, args: string[]): string;
}

const systemGit: GitCommandRunner = {
  run(cwd, args) {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      windowsHide: true,
    }).trim();
  },
};

export function autoCommitAndPush(
  input: AutoCommitInput,
  git: GitCommandRunner = systemGit
): AutoCommitResult {
  let repository: string | undefined;
  try {
    repository = git.run(input.cwd, ['rev-parse', '--show-toplevel']);
    if (!git.run(repository, ['status', '--porcelain']).trim()) {
      return { status: 'no_changes', repository };
    }

    // `--all` is required: it stages modifications, deletions, and untracked
    // source files created by implementation or test generation.
    git.run(repository, ['add', '--all']);
    if (!git.run(repository, ['diff', '--cached', '--name-only']).trim()) {
      return { status: 'no_changes', repository };
    }

    git.run(repository, ['commit', '-m', `feat(${input.workflow}): complete ${input.runId}`]);
    const commit = git.run(repository, ['rev-parse', 'HEAD']);
    try {
      git.run(repository, ['push']);
      return { status: 'committed_and_pushed', repository, commit };
    } catch (error) {
      return { status: 'push_failed', repository, commit, error: errorMessage(error) };
    }
  } catch (error) {
    return { status: 'commit_failed', ...(repository ? { repository } : {}), error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
