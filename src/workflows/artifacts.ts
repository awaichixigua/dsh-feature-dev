/**
 * Per-workflow artifact expectations.
 *
 * Used by ArtifactValidator to confirm a phase has actually produced
 * what the workflow expected. The specs are deliberately minimal:
 * presence is the contract; deep content checks live in the subagent.
 */

import type { FeatureDevInvocation, WorkflowId } from '../types/contracts.js';
import type { ArtifactSpec } from '../runtime/artifact-validator.js';

export function getArtifactsForWorkflow(
  workflow: WorkflowId,
  inv: FeatureDevInvocation
): ArtifactSpec[] {
  const featureDir = inv.featureDir ?? inv.projectRoot;
  switch (workflow) {
    case 'implementation-plan':
    case 'mrd-to-code':
      return [
        { path: `${featureDir}/mrd-original.md`, minSize: 1 },
        { path: `${featureDir}/prd.md`, minSize: 200, mustContain: ['# '] },
        { path: `${featureDir}/tech-design.md`, minSize: 200, mustContain: ['# '] },
        { path: `${featureDir}/feature-map.json`, minSize: 80, json: true },
      ];
    case 'code-gen-tdd':
      return [
        { path: `${featureDir}/ai/test_spec.md`, minSize: 100, mustContain: ['# '] },
        { path: `${featureDir}/ai/code-review.md`, minSize: 100 },
        { path: `${featureDir}/ai/unit_test_report.md`, minSize: 100 },
      ];
    case 'bugfix':
      // Bugfix reports are case-owned (`bugfix/<number>-<slug>/`). The
      // dynamic path is resolved in workflows/bugfix.ts after LOCATE selects
      // the case directory, so no shared root-level artifact exists here.
      return [];
    case 'archive':
      return [
        { path: `${featureDir}/archive-report.md`, minSize: 100 },
      ];
    case 'knowledge-base':
      return [
        { path: `${inv.projectRoot}/app-knowledge-base/CONTEXT.md`, minSize: 100 },
      ];
    default:
      return [];
  }
}
