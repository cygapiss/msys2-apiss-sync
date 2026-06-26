import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceConfigEntry {
  Repo: string;
  Branch: string;
  DestSubdir: string;
  SortKey: string;
  CursorBranch: string;
  UpstreamRepo: string;
  CommitMessage: string;
}

export const DEFAULT_REPLAY_COMMIT_MESSAGE_TEMPLATE =
  '[{SortKey}] {Subject}{BodyBlock}Source: {UpstreamRepo}@{UpstreamSha}';

export interface SyncConfig {
  ReplaySpecVersion: number;
  Owner: string;
  Destination: {
    Repo: string;
    Url?: string;
    BaseCommit: string;
    ReplayTip: string;
  };
  Sources: SourceConfigEntry[];
  Mirrors: {
    Repos: string[];
    SyncIntervalMinutes: number;
    DispatchEventType: string;
  };
  Replay: {
    MinReplayAgeMinutes?: number;
    SkipEmptyTreeDiff: boolean;
    LineEnding: string;
  };
  PollIntervalMinutes: number;
  DailyReconciliationCron: string;
}

export function getSyncRepoRoot(startPath = dirname(fileURLToPath(import.meta.url))): string {
  let current = startPath;
  while (true) {
    try {
      readFileSync(join(current, 'config', 'sync.json'), 'utf8');
      return current;
    } catch (error) {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error('Could not locate sync repo root (config/sync.json not found).');
      }
      current = parent;
    }
  }
}

export function loadSyncConfig(repoRoot = getSyncRepoRoot(), configPath?: string): SyncConfig {
  const path = configPath ?? join(repoRoot, 'config', 'sync.json');
  return JSON.parse(readFileSync(path, 'utf8')) as SyncConfig;
}

export function getDestinationCloneUrl(config: SyncConfig): string {
  return config.Destination.Url ?? `https://github.com/${config.Owner}/${config.Destination.Repo}.git`;
}

export function getMirrorCloneUrlForSource(config: SyncConfig, source: SourceConfigEntry): string {
  return getMirrorCloneUrlByRepoName(config, source.Repo);
}

export function getMirrorCloneUrlByRepoName(config: SyncConfig, repoName: string): string {
  return `https://github.com/${config.Owner}/${repoName}.git`;
}

export function getMirrorPollRepoNames(config: SyncConfig): string[] {
  return config.Mirrors.Repos;
}

export function getSourceConfigEntry(config: SyncConfig, sourceId: string): SourceConfigEntry {
  const normalized = sourceId.trim().toLowerCase();
  for (const entry of config.Sources) {
    if (
      entry.SortKey === sourceId ||
      entry.SortKey === normalized ||
      entry.Repo === sourceId ||
      entry.Repo.toLowerCase() === normalized ||
      entry.UpstreamRepo.toLowerCase() === normalized ||
      `${config.Owner}/${entry.Repo}`.toLowerCase() === normalized
    ) {
      return entry;
    }
  }
  throw new Error(`Unknown source: ${sourceId}`);
}

export function getSourceConfigBySortKey(config: SyncConfig, sortKey: string): SourceConfigEntry {
  return getSourceConfigEntry(config, sortKey);
}

export function resolveSourcesForCli(config: SyncConfig, sourceOption: string): SourceConfigEntry[] {
  const normalized = sourceOption.trim().toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'both') {
    return config.Sources;
  }
  return [getSourceConfigEntry(config, sourceOption)];
}
