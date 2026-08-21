import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasUnsafeWorktreeChanges,
  prepareRequirementBranches,
  requirementBranchName,
  type GitClient,
} from '../../src/workflows/branch-gate.ts';

void test('requirementBranchName follows the legacy naming convention', () => {
  assert.equal(
    requirementBranchName('C:/repo/req/2.1.10_98532_Engios平台接入应用', ' 张 三 '),
    'fun_2.1.10_98532_Engios平台接入应用_张-三'
  );
});

void test('requirementBranchName rejects an unstructured feature directory', () => {
  assert.throws(() => requirementBranchName('C:/repo/req/create-order', '张三'), /需求目录名/);
});

void test('branch gate permits only its own untracked planning artifacts', () => {
  const repo = 'C:/repo';
  const featureDir = 'C:/repo/req/2.1.10_98532_订单创建';
  assert.equal(hasUnsafeWorktreeChanges('?? req/2.1.10_98532_订单创建/apps.json', repo, featureDir), false);
  assert.equal(hasUnsafeWorktreeChanges(' M src/OrderService.ts', repo, featureDir), true);
  assert.equal(hasUnsafeWorktreeChanges('?? src/scratch.ts', repo, featureDir), true);
});

void test('branch gate creates and publishes a missing remote branch', () => {
  const root = join(process.cwd(), '.tmp-branch-gate-test');
  const featureDir = join(root, 'req', '2.1.10_98532_订单创建');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
    primary: ['orders'], collaborators: [], repositories: { orders: 'services/orders' },
  }));

  const commands: string[] = [];
  const git: GitClient = {
    run(cwd, args) {
      commands.push(`${cwd}|${args.join(' ')}`);
      if (args.join(' ') === 'rev-parse --show-toplevel') return join(root, 'services', 'orders');
      if (args.join(' ') === 'config user.name') return '张三';
      if (args.join(' ') === 'branch --show-current') return 'release';
      if (args.join(' ') === 'status --porcelain') return '';
      return '';
    },
    succeeds(_cwd, args) {
      return args.join(' ').includes('refs/remotes/origin/release');
    },
  };

  const result = prepareRequirementBranches({ projectRoot: root, featureDir }, git);
  assert.equal(result.ok, true);
  assert.match(result.evidence[0] ?? '', /remote_created/);
  assert.ok(commands.some((command) => command.endsWith('|fetch origin --prune')));
  assert.ok(commands.some((command) => command.includes('switch -c fun_2.1.10_98532_订单创建_张三 --track origin/release')));
  assert.ok(commands.some((command) => command.endsWith('|push -u origin fun_2.1.10_98532_订单创建_张三')));
  rmSync(root, { recursive: true, force: true });
});

void test('branch gate fast-forwards an existing remote requirement branch', () => {
  const root = join(process.cwd(), '.tmp-branch-gate-test-existing');
  const featureDir = join(root, 'req', '2.1.10_98532_订单创建');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
    primary: ['orders'], collaborators: [], repositories: { orders: 'services/orders' },
  }));

  const commands: string[] = [];
  const git: GitClient = {
    run(cwd, args) {
      commands.push(`${cwd}|${args.join(' ')}`);
      if (args.join(' ') === 'rev-parse --show-toplevel') return join(root, 'services', 'orders');
      if (args.join(' ') === 'config user.name') return '张三';
      if (args.join(' ') === 'branch --show-current') return 'release';
      if (args.join(' ') === 'status --porcelain') return '';
      return '';
    },
    succeeds(_cwd, args) {
      return args.join(' ').includes('refs/remotes/origin/');
    },
  };

  const result = prepareRequirementBranches({ projectRoot: root, featureDir }, git);
  assert.equal(result.ok, true);
  assert.match(result.evidence[0] ?? '', /remote_existing/);
  assert.ok(commands.some((command) => command.endsWith('|switch --track -c fun_2.1.10_98532_订单创建_张三 origin/fun_2.1.10_98532_订单创建_张三')));
  assert.ok(commands.some((command) => command.endsWith('|merge --ff-only origin/fun_2.1.10_98532_订单创建_张三')));
  assert.equal(commands.some((command) => command.includes('|push -u origin')), false);
  rmSync(root, { recursive: true, force: true });
});
