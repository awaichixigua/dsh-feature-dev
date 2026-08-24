/** Resolve the writable service repositories declared by a routed apps.json. */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { isInside } from './paths.js';

export interface ServiceTarget {
  service: string;
  projectRoot: string;
  featureDir: string;
}

const SERVICE_STATUS_PREFIX = 'service_status:';

/** Evidence marker used to persist per-service phase outcomes across repairs. */
export function serviceStatusEvidence(service: string, status: string): string {
  return `${SERVICE_STATUS_PREFIX}${service}:${status}`;
}

/** Limit a repair to failed/blocked services; legacy states fall back to all. */
export function selectRepairTargets(targets: ServiceTarget[], evidence: string[] | undefined): ServiceTarget[] {
  const failed = new Set<string>();
  for (const item of evidence ?? []) {
    if (!item.startsWith(SERVICE_STATUS_PREFIX)) continue;
    const remainder = item.slice(SERVICE_STATUS_PREFIX.length);
    const splitAt = remainder.lastIndexOf(':');
    if (splitAt < 1) continue;
    const service = remainder.slice(0, splitAt);
    const status = remainder.slice(splitAt + 1);
    if (status === 'block' || status === 'failed') failed.add(service);
  }
  if (failed.size === 0) return targets;
  const selected = targets.filter((target) => failed.has(target.service));
  return selected.length > 0 ? selected : targets;
}

interface AppsFile {
  primary?: unknown;
  collaborators?: unknown;
  repositories?: unknown;
}

/**
 * Return one target for each writable service. A feature without apps.json is
 * a single-service run and retains the caller's project root.
 */
export function resolveServiceTargets(projectRoot: string, featureDir: string): ServiceTarget[] {
  const appsPath = resolve(featureDir, 'apps.json');
  if (!existsSync(appsPath)) {
    return [{ service: 'default', projectRoot, featureDir }];
  }
  let apps: AppsFile;
  try {
    apps = JSON.parse(readFileSync(appsPath, 'utf8')) as AppsFile;
  } catch {
    throw new Error(`apps.json is not valid JSON: ${appsPath}`);
  }
  const primary = readNames(apps.primary, 'primary');
  const collaborators = readNames(apps.collaborators, 'collaborators');
  if (primary.length === 0) throw new Error(`apps.json must declare at least one primary service: ${appsPath}`);
  if (!apps.repositories || typeof apps.repositories !== 'object' || Array.isArray(apps.repositories)) {
    throw new Error(`apps.json must declare repositories: ${appsPath}`);
  }
  const repositories = apps.repositories as Record<string, unknown>;
  const featureName = basename(featureDir);
  const canonicalProjectRoot = realpathSync(projectRoot);
  return [...new Set([...primary, ...collaborators])].map((service) => {
    const location = repositories[service];
    if (typeof location !== 'string' || !location.trim()) {
      throw new Error(`apps.json.repositories.${service} is missing`);
    }
    const repository = isAbsolute(location) ? resolve(location) : resolve(projectRoot, location);
    if (!isInside(repository, projectRoot)) {
      throw new Error(`apps.json.repositories.${service} is outside projectRoot: ${repository}`);
    }
    if (!existsSync(repository)) {
      throw new Error(`apps.json.repositories.${service} does not exist: ${repository}`);
    }
    if (!statSync(repository).isDirectory()) {
      throw new Error(`apps.json.repositories.${service} is not a directory: ${repository}`);
    }
    const canonicalRepository = realpathSync(repository);
    if (!isInside(canonicalRepository, canonicalProjectRoot)) {
      throw new Error(`apps.json.repositories.${service} is outside projectRoot: ${repository}`);
    }
    return { service, projectRoot: repository, featureDir: resolve(repository, 'req', featureName) };
  });
}

function readNames(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`apps.json.${field} must be an array of service names`);
  }
  return value.map((item) => item.trim());
}
