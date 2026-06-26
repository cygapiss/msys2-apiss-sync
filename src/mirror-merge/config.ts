export type { Logger } from '../git/log.ts';

export interface SourceConfigEntry {
  Repo: string;
  Branch: string;
  DestSubdir: string;
  SortKey: string;
  CursorBranch: string;
  UpstreamRepo: string;
  CommitMessage: string;
}

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

export function getDestinationCloneUrl(config: SyncConfig): string {
  return config.Destination.Url ?? `https://github.com/${config.Owner}/${config.Destination.Repo}.git`;
}

export function getMirrorCloneUrlForSource(config: SyncConfig, source: SourceConfigEntry): string {
  return `https://github.com/${config.Owner}/${source.Repo}.git`;
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
