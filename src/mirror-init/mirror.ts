import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { join } from 'node:path';

import {
  getMirrorCloneUrl,
  getMirrorSyncConfigPath,
  getMirrorSyncWorkflowTemplatePath,
  getSyncRepoRoot
} from './config.ts';
import { MIRROR_SYNC_BRANCH } from '../types/constants.ts';
import {
  assertWorkingCopyMirror,
  fetchOriginBranchOptional,
  fetchRemoteBranchGraph,
  firstCommitOfBranch,
  isToolingLayoutValid,
  refExists
} from './layout.ts';
import { ghRemoteHasBranch, ghRepoClone } from '../git/gh.ts';
import {
  defaultBranchRef,
  ensureToolingBranchCheckout,
  pushDefaultBranchIfMissing,
  pushToolingBranch,
  repairToolingBranchLayout,
  setGitRepoUtf8Encoding
} from './tooling-repo.ts';
import { githubSshPushUrl, runGit, runGitText } from '../git/index.ts';
import type { Logger } from '../git/log.ts';

export const MIRROR_SYNC_COMMIT_MESSAGE =
  'Mirror sync workflow from msys2-apiss-sync\n\n' +
  'https://github.com/cygapiss/msys2-apiss-sync/tree/main/config/mirror-sync\n' +
  'https://github.com/cygapiss/msys2-apiss-sync/blob/main/config/mirror-template/mirror-sync.yml';


function loadMirrorUpstreamUrl(repoRoot: string, repoName: string): string | null {
  const configPath = getMirrorSyncConfigPath(repoRoot, repoName);
  if (!existsSync(configPath)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { UpstreamUrl?: string };
  return parsed.UpstreamUrl ?? null;
}

function normalizeText(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function mirrorSyncWorkflowMatchesTemplate(mirrorPath: string, repoRoot: string): boolean {
  const workflowPath = getMirrorSyncWorkflowTemplatePath(repoRoot);
  const mirrorYml = join(mirrorPath, '.github', 'workflows', 'mirror-sync.yml');
  if (!existsSync(mirrorYml)) {
    return false;
  }
  return (
    normalizeText(readFileSync(mirrorYml, 'utf8')) === normalizeText(readFileSync(workflowPath, 'utf8'))
  );
}

function copyMirrorSyncWorkflow(mirrorPath: string, repoRoot: string, repoName: string, logger: Logger): void {
  const workflowPath = getMirrorSyncWorkflowTemplatePath(repoRoot);
  const githubDir = join(mirrorPath, '.github');
  const workflowsDir = join(githubDir, 'workflows');
  mkdirSync(workflowsDir, { recursive: true });
  copyFileSync(workflowPath, join(workflowsDir, 'mirror-sync.yml'));
  const staleJson = join(githubDir, 'mirror-sync.json');
  if (existsSync(staleJson)) {
    rmSync(staleJson);
  }
  logger.write(`Applied config/mirror-template/mirror-sync.yml to ${mirrorPath} (${repoName})`);
}

export function mirrorOriginHasContent(
  owner: string,
  repoName: string,
  contentBranch: string
): boolean {
  return (
    ghRemoteHasBranch(owner, repoName, contentBranch) ||
    ghRemoteHasBranch(owner, repoName, MIRROR_SYNC_BRANCH)
  );
}

export function bootstrapMirrorFromUpstreamRoot(input: {
  UpstreamUrl: string;
  OriginUrl: string;
  MirrorPath: string;
  ContentBranch: string;
  RepoName: string;
  Logger: Logger;
}): void {
  input.Logger.write(
    `Bootstrapping ${input.RepoName}: fetch upstream ${input.ContentBranch} commit graph (blob:none)`
  );
  runGit(null, ['init', input.MirrorPath], {}, 5, input.Logger);
  runGit(input.MirrorPath, ['remote', 'add', 'upstream', input.UpstreamUrl], {}, 5, input.Logger);
  runGit(input.MirrorPath, ['remote', 'add', 'origin', input.OriginUrl], {}, 5, input.Logger);
  fetchRemoteBranchGraph(input.MirrorPath, 'upstream', input.ContentBranch, input.Logger);
  const root = firstCommitOfBranch(input.MirrorPath, `upstream/${input.ContentBranch}`);
  runGit(input.MirrorPath, ['checkout', '-B', input.ContentBranch, root], {}, 5, input.Logger);
  runGit(
    input.MirrorPath,
    ['update-ref', `refs/remotes/origin/${input.ContentBranch}`, root],
    {},
    5,
    input.Logger
  );
  runGit(input.MirrorPath, ['checkout', '-B', MIRROR_SYNC_BRANCH, root], {}, 5, input.Logger);
}

export function repairSyncBranchLayout(
  mirrorPath: string,
  contentBranch: string,
  logger: Logger,
  options?: { CommitMessage?: string; Force?: boolean }
): boolean {
  return repairToolingBranchLayout({
    RepoPath: mirrorPath,
    DefaultBranch: contentBranch,
    ToolingBranch: MIRROR_SYNC_BRANCH,
    Paths: ['.github'],
    Message: options?.CommitMessage ?? MIRROR_SYNC_COMMIT_MESSAGE,
    Logger: logger,
    Force: options?.Force
  });
}

export function applyMirrorSyncTemplate(input: {
  MirrorPath: string;
  RepoName: string;
  ContentBranch: string;
  Logger: Logger;
  RepoRoot?: string;
  NeedsBootstrap?: boolean;
}): boolean {
  if (input.NeedsBootstrap === false) {
    input.Logger.write(`${input.RepoName}: config digest pinned; skipping template apply`);
    return false;
  }
  const repoRoot = input.RepoRoot ?? getSyncRepoRoot();
  const configPath = getMirrorSyncConfigPath(repoRoot, input.RepoName);
  const workflowPath = getMirrorSyncWorkflowTemplatePath(repoRoot);

  if (!existsSync(configPath)) {
    input.Logger.write(`No config/mirror-sync/${input.RepoName}.json template`, 'Warn');
    return false;
  }
  if (!existsSync(workflowPath)) {
    throw new Error(`Missing mirror workflow template: ${workflowPath}`);
  }
  if (!refExists(input.MirrorPath, MIRROR_SYNC_BRANCH)) {
    return false;
  }

  fetchOriginBranchOptional(input.MirrorPath, input.ContentBranch, input.Logger);
  const defaultRef = defaultBranchRef(input.MirrorPath, input.ContentBranch);
  const layoutValid = isToolingLayoutValid(input.MirrorPath, defaultRef, MIRROR_SYNC_BRANCH);
  const workflowInSync = mirrorSyncWorkflowMatchesTemplate(input.MirrorPath, repoRoot);
  if (layoutValid && workflowInSync) {
    input.Logger.write(`${input.RepoName}: ${MIRROR_SYNC_BRANCH} templates already in sync`);
    return false;
  }

  const root = firstCommitOfBranch(input.MirrorPath, defaultRef);
  runGit(input.MirrorPath, ['checkout', '-B', MIRROR_SYNC_BRANCH, root], {}, 5, input.Logger);
  if (!workflowInSync) {
    copyMirrorSyncWorkflow(input.MirrorPath, repoRoot, input.RepoName, input.Logger);
  } else if (refExists(input.MirrorPath, `origin/${MIRROR_SYNC_BRANCH}`)) {
    runGit(
      input.MirrorPath,
      ['checkout', `origin/${MIRROR_SYNC_BRANCH}`, '--', '.github/workflows/mirror-sync.yml'],
      {},
      5,
      input.Logger
    );
  }
  const staleJson = join(input.MirrorPath, '.github', 'mirror-sync.json');
  if (existsSync(staleJson)) {
    rmSync(staleJson);
  }
  runGit(input.MirrorPath, ['add', '-A', '.github'], {}, 5, input.Logger);
  runGit(input.MirrorPath, ['commit', '-m', MIRROR_SYNC_COMMIT_MESSAGE], {}, 5, input.Logger);
  return true;
}

function maybeEnsureGithubSshPushUrl(mirrorPath: string, repoName: string, logger: Logger): void {
  const configPath = getMirrorSyncConfigPath(getSyncRepoRoot(), repoName);
  let pushViaSsh = false;
  try {
    pushViaSsh = (JSON.parse(readFileSync(configPath, 'utf8')) as { PushViaSsh?: boolean }).PushViaSsh === true;
  } catch {
    return;
  }
  if (!pushViaSsh) {
    return;
  }
  let originUrl: string;
  try {
    originUrl = runGitText(mirrorPath, ['remote', 'get-url', 'origin']).trim();
  } catch {
    return;
  }
  const sshUrl = githubSshPushUrl(originUrl);
  if (!sshUrl) {
    return;
  }
  runGit(mirrorPath, ['remote', 'set-url', '--push', 'origin', sshUrl], {}, 5, logger);
  logger.write(`origin push URL: ${sshUrl}`);
}

export function pushMirrorContentBranchIfMissing(
  mirrorPath: string,
  contentBranch: string,
  repoName: string,
  logger: Logger
): boolean {
  return pushDefaultBranchIfMissing({
    RepoPath: mirrorPath,
    DefaultBranch: contentBranch,
    Label: repoName,
    Logger: logger
  });
}

export function pushMirrorSyncBranch(
  mirrorPath: string,
  repoName: string,
  logger: Logger
): boolean {
  maybeEnsureGithubSshPushUrl(mirrorPath, repoName, logger);
  return pushToolingBranch({
    RepoPath: mirrorPath,
    ToolingBranch: MIRROR_SYNC_BRANCH,
    Label: repoName,
    Logger: logger,
    ForceWithLease: true
  });
}

function ensureMirrorSyncBranch(mirrorPath: string, contentBranch: string, logger: Logger): void {
  ensureToolingBranchCheckout({
    RepoPath: mirrorPath,
    DefaultBranch: contentBranch,
    ToolingBranch: MIRROR_SYNC_BRANCH,
    Logger: logger
  });
  const defaultRef = defaultBranchRef(mirrorPath, contentBranch);
  if (
    !isToolingLayoutValid(mirrorPath, defaultRef, MIRROR_SYNC_BRANCH) &&
    existsSync(join(mirrorPath, '.github'))
  ) {
    repairSyncBranchLayout(mirrorPath, contentBranch, logger, { Force: true });
  }
}

export function initializeNamedMirrorRepository(input: {
  WorkDirectory: string;
  RepoName: string;
  ContentBranch: string;
  Owner: string;
  SkipFetch: boolean;
  Logger: Logger;
  NeedsBootstrap?: boolean;
}): string {
  const mirrorRoot = join(input.WorkDirectory, 'mirrors');
  mkdirSync(mirrorRoot, { recursive: true });
  const mirrorPath = join(mirrorRoot, input.RepoName);
  const owner = input.Owner;
  const repoRoot = getSyncRepoRoot();

  if (existsSync(mirrorPath) && (!existsSync(join(mirrorPath, '.git')) || !refExists(mirrorPath, 'HEAD'))) {
    input.Logger.write(`${input.RepoName}: invalid local mirror; re-initializing`, 'Warn');
    rmSync(mirrorPath, { recursive: true, force: true });
  }

  if (!existsSync(mirrorPath)) {
    if (mirrorOriginHasContent(owner, input.RepoName, input.ContentBranch)) {
      ghRepoClone(owner, input.RepoName, mirrorPath, input.Logger);
    } else {
      const upstreamUrl = loadMirrorUpstreamUrl(repoRoot, input.RepoName);
      if (!upstreamUrl) {
        throw new Error(
          `${input.RepoName}: empty origin and no UpstreamUrl; add config/mirror-sync/${input.RepoName}.json`
        );
      }
      bootstrapMirrorFromUpstreamRoot({
        UpstreamUrl: upstreamUrl,
        OriginUrl: getMirrorCloneUrl(owner, input.RepoName),
        MirrorPath: mirrorPath,
        ContentBranch: input.ContentBranch,
        RepoName: input.RepoName,
        Logger: input.Logger
      });
    }
  } else if (!input.SkipFetch) {
    assertWorkingCopyMirror(mirrorPath);
    if (mirrorOriginHasContent(owner, input.RepoName, input.ContentBranch)) {
      input.Logger.write(`Fetching mirror working copy ${input.RepoName}`);
      runGit(mirrorPath, ['fetch', 'origin', '--prune'], {}, 5, input.Logger);
    } else {
      input.Logger.write(`${input.RepoName}: origin has no content yet; skipping origin fetch`);
    }
  } else {
    assertWorkingCopyMirror(mirrorPath);
  }

  ensureMirrorSyncBranch(mirrorPath, input.ContentBranch, input.Logger);
  applyMirrorSyncTemplate({
    MirrorPath: mirrorPath,
    RepoName: input.RepoName,
    ContentBranch: input.ContentBranch,
    Logger: input.Logger,
    NeedsBootstrap: input.NeedsBootstrap
  });
  setGitRepoUtf8Encoding(mirrorPath);
  return mirrorPath;
}
