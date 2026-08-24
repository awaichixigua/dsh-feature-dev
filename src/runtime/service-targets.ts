/** Resolve the writable service repositories declared by a routed apps.json. */

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

export interface ServiceTarget {
  service: string;
  projectRoot: string;
  featureDir: string;
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
  return [...new Set([...primary, ...collaborators])].map((service) => {
    const location = repositories[service];
    if (typeof location !== 'string' || !location.trim()) {
      throw new Error(`apps.json.repositories.${service} is missing`);
    }
    const repository = isAbsolute(location) ? resolve(location) : resolve(projectRoot, location);
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
