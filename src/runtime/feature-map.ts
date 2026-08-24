/** Resolve the service scope of one implementation feature from a tech design. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServiceTarget } from './service-targets.js';

export interface FeatureMapEntry {
  id: string;
  name: string;
  services: string[];
  primaryService?: string;
  acceptanceCriteria?: string[];
}

interface FeatureMapFile {
  features?: unknown;
}

export interface FeatureTargetSelection {
  targets: ServiceTarget[];
  feature?: FeatureMapEntry;
  featureMapPath?: string;
}

/** Select only the services that own a requested feature; omit the id for all services. */
export function selectFeatureTargets(
  featureDir: string,
  allTargets: ServiceTarget[],
  featureId?: string
): FeatureTargetSelection {
  if (!featureId) return { targets: allTargets };

  const featureMapPath = resolve(featureDir, 'feature-map.json');
  const feature = validateFeatureMap(featureDir, allTargets).find((item) => item.id === featureId);
  if (!feature) throw new Error(`Feature ${featureId} is not declared in ${featureMapPath}`);
  const targets = allTargets.filter((target) => feature.services.includes(target.service));
  if (targets.length === 0) throw new Error(`Feature ${featureId} has no writable service targets`);
  return { targets, feature, featureMapPath };
}

/** Validate every declared feature before planning is approved or code starts. */
export function validateFeatureMap(featureDir: string, allTargets: ServiceTarget[]): FeatureMapEntry[] {
  const featureMapPath = resolve(featureDir, 'feature-map.json');
  if (!existsSync(featureMapPath)) throw new Error(`feature-map.json is missing: ${featureMapPath}`);
  const features = readFeatureMap(featureMapPath);
  const available = new Set(allTargets.map((target) => target.service));
  for (const feature of features) {
    const unknown = feature.services.filter((service) => !available.has(service));
    if (unknown.length > 0) {
      throw new Error(`Feature ${feature.id} references services absent from apps.json: ${unknown.join(', ')}`);
    }
  }
  return features;
}

function readFeatureMap(featureMapPath: string): FeatureMapEntry[] {
  let parsed: FeatureMapFile;
  try {
    parsed = JSON.parse(readFileSync(featureMapPath, 'utf8')) as FeatureMapFile;
  } catch {
    throw new Error(`feature-map.json is not valid JSON: ${featureMapPath}`);
  }
  if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
    throw new Error(`feature-map.json must declare a non-empty features array: ${featureMapPath}`);
  }
  const features = parsed.features.map((value, index) => readEntry(value, index, featureMapPath));
  if (new Set(features.map((feature) => feature.id)).size !== features.length) {
    throw new Error(`feature-map.json contains duplicate feature ids: ${featureMapPath}`);
  }
  return features;
}

function readEntry(value: unknown, index: number, featureMapPath: string): FeatureMapEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`feature-map.json.features[${index}] must be an object: ${featureMapPath}`);
  }
  const entry = value as Record<string, unknown>;
  const id = requiredText(entry.id, `features[${index}].id`, featureMapPath);
  if (!/^F-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`feature-map.json.features[${index}].id must use the F-<identifier> form: ${featureMapPath}`);
  }
  const name = requiredText(entry.name, `features[${index}].name`, featureMapPath);
  if (!Array.isArray(entry.services) || entry.services.length === 0 || entry.services.some((service) => typeof service !== 'string' || !service.trim())) {
    throw new Error(`feature-map.json.features[${index}].services must be a non-empty service array: ${featureMapPath}`);
  }
  const acceptanceCriteria = entry.acceptanceCriteria;
  if (acceptanceCriteria !== undefined && (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.some((item) => typeof item !== 'string' || !item.trim()))) {
    throw new Error(`feature-map.json.features[${index}].acceptanceCriteria must be a non-empty string array: ${featureMapPath}`);
  }
  const services = [...new Set(entry.services.map((service) => service.trim()))];
  const primaryService = entry.primaryService === undefined
    ? undefined
    : requiredText(entry.primaryService, `features[${index}].primaryService`, featureMapPath);
  if (primaryService && !services.includes(primaryService)) {
    throw new Error(`feature-map.json.features[${index}].primaryService must be included in services: ${featureMapPath}`);
  }
  return {
    id,
    name,
    services,
    ...(primaryService ? { primaryService } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria: acceptanceCriteria.map((item) => item.trim()) } : {}),
  };
}

function requiredText(value: unknown, field: string, featureMapPath: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`feature-map.json.${field} must be non-empty: ${featureMapPath}`);
  return value.trim();
}
