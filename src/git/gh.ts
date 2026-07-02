import { spawnSync } from 'node:child_process';

import type { Logger } from './log.ts';
import {
  type GhDispatchAttemptResult,
  type MirrorDispatchSpec,
  parseGhDispatchFailure
} from './mirror-dispatch.ts';

export function runGh(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  };
}

export function ghCommandAvailable(): boolean {
  return runGh(['--version']).ok;
}

export function ghAuthenticated(): boolean {
  if (!ghCommandAvailable()) {
    return false;
  }
  return runGh(['auth', 'status']).ok;
}

export function requireGhAuthenticated(): void {
  if (!ghCommandAvailable()) {
    throw new Error('gh CLI is required (install gh and run gh auth login)');
  }
  if (!ghAuthenticated()) {
    throw new Error('gh is not authenticated; run gh auth login');
  }
}

export function ghRepoExists(owner: string, repoName: string): boolean {
  return runGh(['repo', 'view', `${owner}/${repoName}`]).ok;
}

export function ghRepoCreate(input: {
  Owner: string;
  RepoName: string;
  Description?: string;
  Url?: string;
  Logger: Logger;
}): void {
  if (ghRepoExists(input.Owner, input.RepoName)) {
    input.Logger.write(`${input.Owner}/${input.RepoName} already exists on GitHub`);
    return;
  }
  requireGhAuthenticated();
  input.Logger.write(`Creating GitHub repo ${input.Owner}/${input.RepoName} with gh`);
  const args = ['repo', 'create', `${input.Owner}/${input.RepoName}`, '--public'];
  if (input.Description) {
    args.push('--description', input.Description);
  }
  if (input.Url) {
    args.push('--homepage', input.Url);
  }
  const result = runGh(args);
  if (!result.ok) {
    throw new Error(
      `gh repo create failed for ${input.Owner}/${input.RepoName}: ` +
        (result.stderr || result.stdout || 'unknown error')
    );
  }
  input.Logger.write(`Created ${input.Owner}/${input.RepoName} on GitHub`);
}

export function ghRepoClone(owner: string, repoName: string, targetPath: string, logger: Logger): void {
  requireGhAuthenticated();
  logger.write(`Cloning ${owner}/${repoName} with gh`);
  const result = runGh(['repo', 'clone', `${owner}/${repoName}`, targetPath]);
  if (!result.ok) {
    throw new Error(
      `gh repo clone failed for ${owner}/${repoName}: ${result.stderr || result.stdout || 'unknown error'}`
    );
  }
}

export function ghRemoteHasBranch(owner: string, repoName: string, branch: string): boolean {
  const result = runGh([
    'api',
    `repos/${owner}/${repoName}/branches/${encodeURIComponent(branch)}`,
    '--jq',
    '.name'
  ]);
  return result.ok && result.stdout === branch;
}

export function ghGetBranchSha(owner: string, repoName: string, branch: string): string | null {
  const result = runGh([
    'api',
    `repos/${owner}/${repoName}/branches/${encodeURIComponent(branch)}`,
    '--jq',
    '.commit.sha'
  ]);
  if (!result.ok) {
    return null;
  }
  return result.stdout || null;
}

export function ghGetRepoDefaultBranch(owner: string, repoName: string): string | null {
  const result = runGh(['api', `repos/${owner}/${repoName}`, '--jq', '.default_branch']);
  if (!result.ok) {
    return null;
  }
  return result.stdout || null;
}

export function ghSetRepoDefaultBranch(
  owner: string,
  repoName: string,
  branch: string,
  logger: Logger
): void {
  if (ghGetRepoDefaultBranch(owner, repoName) === branch) {
    return;
  }
  logger.write(`Setting default branch of ${owner}/${repoName} to ${branch}`);
  const result = runGh([
    'api',
    `repos/${owner}/${repoName}`,
    '-X',
    'PATCH',
    '-f',
    `default_branch=${branch}`
  ]);
  if (!result.ok) {
    throw new Error(
      `Failed to set default branch for ${owner}/${repoName}: ` +
        (result.stderr || result.stdout || 'unknown error')
    );
  }
}

function ghMirrorWorkflowRunCount(
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec,
  status: 'in_progress' | 'queued'
): number | null {
  const result = runGh([
    'run',
    'list',
    '--repo',
    `${owner}/${repoName}`,
    '--workflow',
    spec.WorkflowFile,
    '--branch',
    spec.ToolingBranch,
    '--status',
    status,
    '--limit',
    '1',
    '--json',
    'databaseId',
    '-q',
    'length'
  ]);
  if (!result.ok) {
    return null;
  }
  const count = Number.parseInt(result.stdout, 10);
  return Number.isFinite(count) ? count : null;
}

export function ghMirrorWorkflowRunBusy(
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec
): boolean | null {
  for (const status of ['in_progress', 'queued'] as const) {
    const count = ghMirrorWorkflowRunCount(owner, repoName, spec, status);
    if (count === null) {
      return null;
    }
    if (count > 0) {
      return true;
    }
  }
  return false;
}

function ghMirrorRunInProgress(
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec
): boolean | null {
  const count = ghMirrorWorkflowRunCount(owner, repoName, spec, 'in_progress');
  if (count === null) {
    return null;
  }
  return count > 0;
}

function ghAttemptMirrorDispatch(
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec,
  logger?: Logger
): GhDispatchAttemptResult {
  const inProgress = ghMirrorRunInProgress(owner, repoName, spec);
  if (inProgress === true) {
    logger?.write(`Skip ${spec.Mirror} dispatch on ${owner}/${repoName}: run already in progress`);
    return { ok: false, skipped: true };
  }
  const args = [
    'workflow',
    'run',
    spec.WorkflowFile,
    '--repo',
    `${owner}/${repoName}`,
    '--ref',
    spec.ToolingBranch,
    ...spec.WorkflowInputs.flatMap(([key, value]) => ['-f', `${key}=${value}`])
  ];
  const result = runGh(args);
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, ...parseGhDispatchFailure(`${result.stderr} ${result.stdout}`.trim()) };
}

function throwMirrorDispatchFailure(
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec,
  result: GhDispatchAttemptResult,
  forbiddenDetail?: string
): never {
  if (result.notFound) {
    throw new Error(`${spec.Mirror} failed for ${owner}/${repoName}: ${spec.WorkflowFile} not found`);
  }
  if (result.forbidden) {
    throw new Error(
      `${spec.Mirror} failed for ${owner}/${repoName} (403): ` +
        (forbiddenDetail ??
          `gh cannot dispatch ${spec.Mirror}; check gh auth or SYNC_DISPATCH_TOKEN`)
    );
  }
  const suffix = result.detail ? `: ${result.detail}` : '';
  throw new Error(`${spec.Mirror} failed for ${owner}/${repoName}${suffix}`);
}

function handleMirrorDispatchResult(
  result: GhDispatchAttemptResult,
  owner: string,
  repoName: string,
  spec: MirrorDispatchSpec,
  logger: Logger,
  options?: { ForbiddenDetail?: string }
): 'done' | 'not_found' {
  if (result.ok) {
    logger.write(`dispatched ${owner}/${repoName}`);
    return 'done';
  }
  if (result.skipped) {
    return 'done';
  }
  if (result.notFound) {
    return 'not_found';
  }
  throwMirrorDispatchFailure(owner, repoName, spec, result, options?.ForbiddenDetail);
}

export function ghDispatchMirror(
  spec: MirrorDispatchSpec,
  owner: string,
  repoName: string,
  defaultBranch: string,
  logger: Logger,
  options?: { ForbiddenDetail?: string }
): void {
  const restoreDefaultBranch = ghRemoteHasBranch(owner, repoName, defaultBranch);
  let toolingDefaultBranch = false;

  try {
    if (!restoreDefaultBranch) {
      logger.write(
        `${repoName}: ${defaultBranch} not on origin; setting default branch to ${spec.ToolingBranch} before dispatch`
      );
      ghSetRepoDefaultBranch(owner, repoName, spec.ToolingBranch, logger);
      toolingDefaultBranch = true;
    }

    logger.write(`Dispatching ${spec.Mirror} on ${owner}/${repoName}`);
    let result = ghAttemptMirrorDispatch(owner, repoName, spec, logger);
    if (handleMirrorDispatchResult(result, owner, repoName, spec, logger, options) === 'done') {
      return;
    }

    if (!toolingDefaultBranch) {
      logger.write(
        `${repoName}: ${spec.WorkflowFile} not registered; setting default branch to ${spec.ToolingBranch}`
      );
      ghSetRepoDefaultBranch(owner, repoName, spec.ToolingBranch, logger);
      toolingDefaultBranch = true;
    }

    result = ghAttemptMirrorDispatch(owner, repoName, spec, logger);
    if (handleMirrorDispatchResult(result, owner, repoName, spec, logger, options) === 'done') {
      return;
    }

    const newMirrorHint = spec.Mirror === 'mirror-sync' ? ' (normal for new mirrors)' : '';
    logger.write(
      `${repoName}: ${spec.WorkflowFile} not in GitHub Actions registry yet; dispatch skipped${newMirrorHint}`,
      'Warn'
    );
    logger.write('  Wait a few minutes, then retry:', 'Warn');
    if (spec.Mirror === 'mirror-sync') {
      logger.write(`    yarn mirror-init --push --repo ${repoName} --skip-fetch`, 'Warn');
    } else if (spec.Mirror === 'mirror-merge' || spec.Mirror === 'mirror-poll') {
      logger.write('    yarn mirror-init --push', 'Warn');
    }
    const workflowInputs = spec.WorkflowInputs.map(([key, value]) => `-f ${key}=${value}`).join(' ');
    logger.write(
      `    gh workflow run ${spec.WorkflowFile} --repo ${owner}/${repoName} --ref ${spec.ToolingBranch}${workflowInputs ? ` ${workflowInputs}` : ''}`,
      'Warn'
    );
  } finally {
    if (toolingDefaultBranch && restoreDefaultBranch) {
      ghSetRepoDefaultBranch(owner, repoName, defaultBranch, logger);
    }
  }
}

export type { GhDispatchAttemptResult, MirrorDispatchSpec } from './mirror-dispatch.ts';
export { MIRROR_MERGE_DISPATCH, MIRROR_POLL_DISPATCH, MIRROR_SYNC_DISPATCH } from './mirror-dispatch.ts';
