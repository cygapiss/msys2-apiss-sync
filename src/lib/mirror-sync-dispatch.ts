import {
  ghCommandAvailable,
  ghDispatchMirrorSyncWorkflow,
  ghMirrorSyncRunInProgress,
  ghMirrorSyncWorkflowRegistered,
  getGhRepoDefaultBranch,
  requireGhCommand,
  setGhRepoDefaultBranch
} from './gh-cli.ts';
import type { Logger } from './log.ts';
import { MIRROR_SYNC_BRANCH } from './repos.ts';

export function mirrorSyncWorkflowRegistered(owner: string, repoName: string): boolean {
  requireGhCommand();
  return ghMirrorSyncWorkflowRegistered(owner, repoName) ?? false;
}

export function mirrorSyncReadyState(input: {
  WorkflowRegistered: boolean;
}): 'normal' | 'bootstrap' {
  return input.WorkflowRegistered ? 'normal' : 'bootstrap';
}

async function waitForMirrorSyncWorkflowRegistered(input: {
  Owner: string;
  RepoName: string;
  Logger: Logger;
  maxAttempts?: number;
}): Promise<boolean> {
  const maxAttempts = input.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (mirrorSyncWorkflowRegistered(input.Owner, input.RepoName)) {
      return true;
    }
    if (attempt === maxAttempts) {
      return false;
    }
    const delayMs = 2000;
    input.Logger.write(
      `${input.RepoName}: waiting for mirror-sync workflow registration (${attempt}/${maxAttempts})`,
      'Warn'
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function ensureMirrorSyncWorkflowRegistered(input: {
  Owner: string;
  RepoName: string;
  ContentBranch: string;
  Logger: Logger;
}): Promise<void> {
  if (mirrorSyncWorkflowRegistered(input.Owner, input.RepoName)) {
    return;
  }
  input.Logger.write(
    `${input.RepoName}: registering mirror-sync (temporary default branch ${MIRROR_SYNC_BRANCH})`
  );
  const currentDefault = getGhRepoDefaultBranch(input.Owner, input.RepoName);
  if (currentDefault !== MIRROR_SYNC_BRANCH) {
    setGhRepoDefaultBranch(input.Owner, input.RepoName, MIRROR_SYNC_BRANCH, input.Logger);
  }
  const ready = await waitForMirrorSyncWorkflowRegistered(input);
  if (!ready) {
    throw new Error(
      `${input.Owner}/${input.RepoName}: mirror-sync workflow did not register after ` +
        `setting default branch to ${MIRROR_SYNC_BRANCH}`
    );
  }
}

async function restoreMirrorContentDefaultBranch(input: {
  Owner: string;
  RepoName: string;
  ContentBranch: string;
  Logger: Logger;
}): Promise<void> {
  if (input.ContentBranch === MIRROR_SYNC_BRANCH || !ghCommandAvailable()) {
    return;
  }
  const currentDefault = getGhRepoDefaultBranch(input.Owner, input.RepoName);
  if (currentDefault === null || currentDefault === input.ContentBranch) {
    return;
  }
  setGhRepoDefaultBranch(
    input.Owner,
    input.RepoName,
    input.ContentBranch,
    input.Logger
  );
}

class MirrorSyncDispatchNotFoundError extends Error {}

async function dispatchMirrorSyncWorkflow(input: {
  Owner: string;
  RepoName: string;
  Logger?: Logger;
}): Promise<boolean> {
  requireGhCommand();
  const repoSlug = `${input.Owner}/${input.RepoName}`;
  if (input.Logger && (ghMirrorSyncRunInProgress(input.Owner, input.RepoName) ?? false)) {
    input.Logger.write(`Skip mirror-sync dispatch on ${repoSlug}: run already in progress`);
    return false;
  }
  const result = ghDispatchMirrorSyncWorkflow(input.Owner, input.RepoName, input.Logger);
  if (result.ok) {
    return true;
  }
  if (result.skipped) {
    return false;
  }
  if (result.notFound) {
    throw new MirrorSyncDispatchNotFoundError();
  }
  throw new Error(`gh workflow run failed for ${repoSlug}`);
}

async function dispatchWithRetry(
  owner: string,
  repo: string,
  contentBranch: string,
  logger: Logger,
  maxAttempts = 4
): Promise<void> {
  let bootstrapped = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await dispatchMirrorSyncWorkflow({ Owner: owner, RepoName: repo, Logger: logger });
      return;
    } catch (error) {
      if (error instanceof MirrorSyncDispatchNotFoundError && !bootstrapped) {
        bootstrapped = true;
        logger.write(`${repo}: mirror-sync not registered; bootstrapping workflow`, 'Warn');
        await ensureMirrorSyncWorkflowRegistered({
          Owner: owner,
          RepoName: repo,
          ContentBranch: contentBranch,
          Logger: logger
        });
        continue;
      }
      if (error instanceof MirrorSyncDispatchNotFoundError) {
        throw new Error(
          `${owner}/${repo}: mirror-sync.yml not found for workflow_dispatch after bootstrap. ` +
            'See docs/add-mirror.md.'
        );
      }
      if (attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 1000 * 2 ** (attempt - 1);
      logger.write(
        `Dispatch attempt ${attempt} failed, retry in ${delayMs}ms`,
        'Warn'
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function runMirrorSyncDispatch(input: {
  Owner: string;
  RepoName: string;
  ContentBranch: string;
  Logger: Logger;
}): Promise<void> {
  if (mirrorSyncWorkflowRegistered(input.Owner, input.RepoName)) {
    input.Logger.write(`${input.RepoName}: mirror ready; triggering mirror-sync`);
    await dispatchMirrorSyncWorkflow({
      Owner: input.Owner,
      RepoName: input.RepoName,
      Logger: input.Logger
    });
    return;
  }

  input.Logger.write(`${input.RepoName}: bootstrapping mirror-sync before trigger`);
  if (!mirrorSyncWorkflowRegistered(input.Owner, input.RepoName)) {
    await ensureMirrorSyncWorkflowRegistered(input);
  }

  const triggered = await dispatchMirrorSyncWorkflow({
    Owner: input.Owner,
    RepoName: input.RepoName,
    Logger: input.Logger
  });
  if (triggered) {
    input.Logger.write(`Triggered mirror-sync on ${input.Owner}/${input.RepoName}`);
  }
}

/** After push to msys2-apiss-sync: bootstrap, dispatch mirror-sync, restore default (gh). */
export async function startMirrorSyncAfterPush(input: {
  Owner: string;
  RepoName: string;
  ContentBranch: string;
  Logger: Logger;
}): Promise<void> {
  requireGhCommand();
  await runMirrorSyncDispatch(input);
  await restoreMirrorContentDefaultBranch(input);
}
