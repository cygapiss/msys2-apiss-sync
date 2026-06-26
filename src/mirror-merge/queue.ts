import type { ReplayEntry } from '../types/replay-entry.ts';
import type { SyncConfig } from './config.ts';
import {
  precomputeForkSafeFlagsForQueue
} from './fork-safe.ts';
import { runGitText, streamGitText } from '../git/index.ts';
import { resolveMirrorContentBranchRef } from './history.ts';

export type CommitParentMap = Map<string, readonly string[]>;

const gitEmptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function getFirstParentFromMap(parentMap: CommitParentMap, commit: string): string {
  const parents = parentMap.get(commit);
  if (!parents || parents.length === 0) {
    return gitEmptyTree;
  }
  return parents[0]!;
}

export function compareReplayRank(left: ReplayEntry, right: ReplayEntry): number {
  if (left.CommitterDateUnix !== right.CommitterDateUnix) {
    return Math.sign(left.CommitterDateUnix - right.CommitterDateUnix);
  }
  if (left.AuthorDateUnix !== right.AuthorDateUnix) {
    return Math.sign(left.AuthorDateUnix - right.AuthorDateUnix);
  }
  if (left.SourceId !== right.SourceId) {
    return left.SourceId < right.SourceId ? -1 : 1;
  }
  if (left.Sha === right.Sha) {
    return 0;
  }
  return left.Sha < right.Sha ? -1 : 1;
}

function mergeTwoReplayCommitQueues(left: ReplayEntry[], right: ReplayEntry[]): ReplayEntry[] {
  const merged: ReplayEntry[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (compareReplayRank(left[i]!, right[j]!) <= 0) {
      merged.push(left[i]!);
      i++;
    } else {
      merged.push(right[j]!);
      j++;
    }
  }

  while (i < left.length) {
    merged.push(left[i]!);
    i++;
  }

  while (j < right.length) {
    merged.push(right[j]!);
    j++;
  }

  return merged;
}

export function mergeReplayCommitQueues(...lists: ReplayEntry[][]): ReplayEntry[] {
  if (lists.length === 0) {
    return [];
  }
  let merged = lists[0]!;
  for (let index = 1; index < lists.length; index++) {
    merged = mergeTwoReplayCommitQueues(merged, lists[index]!);
  }
  return merged;
}

export function getReplayAgeCutoffUnix(config: SyncConfig, nowUnix = Math.floor(Date.now() / 1000)): number {
  const minutes = config.Replay.MinReplayAgeMinutes === undefined || config.Replay.MinReplayAgeMinutes < 0
    ? 5
    : config.Replay.MinReplayAgeMinutes;
  return nowUnix - minutes * 60;
}

export async function buildMirrorCommitParentMap(mirrorPath: string, branch = 'master'): Promise<CommitParentMap> {
  const branchRef = resolveMirrorContentBranchRef(mirrorPath, branch);
  const raw = await streamGitText(mirrorPath, ['rev-list', '--parents', branchRef]);
  const map = new Map<string, readonly string[]>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    map.set(parts[0]!, parts.slice(1));
  }
  return map;
}

export function precomputeSourceCursorBranchSafeFlags(
  queueEntries: readonly ReplayEntry[],
  parentMap: CommitParentMap,
  tipSha?: string,
  onProgress?: (processed: number, total: number) => void,
  progressInterval = 2000
): boolean[] {
  return precomputeForkSafeFlagsForQueue(
    queueEntries,
    parentMap,
    tipSha,
    onProgress,
    progressInterval
  );
}

export function precomputeReplayCursorBranchSafeFlags(input: {
  Queue: ReplayEntry[];
  ParentMaps: Record<string, CommitParentMap>;
  SourceEntries?: Record<string, readonly ReplayEntry[]>;
  OnSourceProgress?: (sourceId: string, processed: number, total: number) => void;
  ProgressInterval?: number;
}): boolean[] {
  const sourceIds = [...new Set(input.Queue.map((entry) => entry.SourceId))];
  const progressInterval = input.ProgressInterval ?? 2000;
  const safeBySource: Record<string, boolean[]> = {};
  for (const sourceId of sourceIds) {
    const entries =
      input.SourceEntries?.[sourceId] ?? input.Queue.filter((entry) => entry.SourceId === sourceId);
    safeBySource[sourceId] = precomputeSourceCursorBranchSafeFlags(
      entries,
      input.ParentMaps[sourceId]!,
      undefined,
      input.OnSourceProgress
        ? (processed, total) => input.OnSourceProgress!(sourceId, processed, total)
        : undefined,
      progressInterval
    );
  }
  const indices: Record<string, number> = {};
  const cursorSafe: Record<string, boolean> = {};
  for (const sourceId of sourceIds) {
    indices[sourceId] = 0;
    cursorSafe[sourceId] = true;
  }
  const flags = new Array<boolean>(input.Queue.length);
  for (let index = 0; index < input.Queue.length; index++) {
    const entry = input.Queue[index]!;
    cursorSafe[entry.SourceId] = safeBySource[entry.SourceId]![indices[entry.SourceId]!] ?? true;
    indices[entry.SourceId]!++;
    flags[index] = sourceIds.every((sourceId) => cursorSafe[sourceId]);
  }
  return flags;
}

export function filterReplayQueueByAge(
  queue: ReplayEntry[],
  config: SyncConfig,
  log: (message: string) => void,
  nowUnix = Math.floor(Date.now() / 1000)
): ReplayEntry[] {
  const minutes = config.Replay.MinReplayAgeMinutes ?? 5;
  const cutoff = getReplayAgeCutoffUnix(config, nowUnix);
  const eligible = queue.filter((entry) => entry.CommitterDateUnix <= cutoff);
  const held = queue.length - eligible.length;
  if (held > 0) {
    log(`Holding ${held} commit(s) with committer date within the last ${minutes} minute(s) to avoid timeline reorder.`);
  }
  return eligible;
}
