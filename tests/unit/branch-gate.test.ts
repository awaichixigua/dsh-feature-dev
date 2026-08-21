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
  mkdirSync(join(root, 'services', 'orders', '.git'), { recursive: true });
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
  mkdirSync(join(root, 'services', 'orders', '.git'), { recursive: true });
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

void test('branch gate preflight: monorepo root path is reported as actionable hint', () => {
  const root = join(process.cwd(), '.tmp-branch-gate-preflight-monorepo');
  const featureDir = join(root, 'req', '2.0.0_103111_fastjson替换为jackson');
  const engiCommon = join(root, 'engi-common');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(featureDir, { recursive: true });
  // projectRoot itself has no .git (monorepo); engi-common is the real git repo.
  mkdirSync(join(engiCommon, '.git'), { recursive: true });
  writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
    primary: ['engi-common'], collaborators: [], repositories: { 'engi-common': '.' },
  }));

  const commands: string[] = [];
  const git: GitClient = {
    run(cwd, args) {
      commands.push(`${cwd}|${args.join(' ')}`);
      return cwd;
    },
    succeeds() { return true; },
  };

  try {
    const result = prepareRequirementBranches({ projectRoot: root, featureDir }, git);
    assert.equal(result.ok, false);
    assert.match(result.blocker ?? '', /apps\.json 仓库路径预检未通过/);
    assert.match(result.blocker ?? '', /projectRoot 本身/);
    assert.match(result.blocker ?? '', /engi-common/);
    // Must not have run any git command — the preflight blocks before we
    // touch the repository.
    assert.equal(commands.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('branch gate preflight: nonexistent path is reported with the resolved absolute path', () => {
  const root = join(process.cwd(), '.tmp-branch-gate-preflight-missing');
  const featureDir = join(root, 'req', '2.0.0_103111_fastjson替换为jackson');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
    primary: ['engi-common'], collaborators: [], repositories: { 'engi-common': 'services/engi-common' },
  }));

  try {
    const result = prepareRequirementBranches({ projectRoot: root, featureDir });
    assert.equal(result.ok, false);
    assert.match(result.blocker ?? '', /不存在/);
    assert.match(result.blocker ?? '', /services[\\/]engi-common/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('branch gate preflight: directory without .git is reported with sibling git repo hint', () => {
  const root = join(process.cwd(), '.tmp-branch-gate-preflight-nongit');
  const featureDir = join(root, 'req', '2.0.0_103111_fastjson替换为jackson');
  const engiCommon = join(root, 'engi-common');
  const someDir = join(root, 'engi-json-starter');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(featureDir, { recursive: true });
  // engi-common is a real git repo; engi-json-starter is a plain directory
  // (no .git), simulating an LLM that picked the wrong sibling.
  mkdirSync(join(engiCommon, '.git'), { recursive: true });
  mkdirSync(someDir, { recursive: true });
  writeFileSync(join(featureDir, 'apps.json'), JSON.stringify({
    primary: ['engi-common'], collaborators: [], repositories: { 'engi-common': 'engi-json-starter' },
  }));

  try {
    const result = prepareRequirementBranches({ projectRoot: root, featureDir });
    assert.equal(result.ok, false);
    assert.match(result.blocker ?? '', /不是 git 仓库/);
    assert.match(result.blocker ?? '', /engi-common/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
