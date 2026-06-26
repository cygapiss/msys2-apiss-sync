import type { ReplayEntry } from './replay-entry.ts';

export type CommitParentMap = Map<string, readonly string[]>;

export function buildFirstParentSpine(parentMap: CommitParentMap, tipSha: string): ReadonlySet<string> {
  const spine = new Set<string>();
  let current: string | undefined = tipSha;
  while (current) {
    spine.add(current);
    const parents = parentMap.get(current);
    if (!parents || parents.length === 0) {
      break;
    }
    current = parents[0];
  }
  return spine;
}

export function precomputeForkSafeFlagsForQueue(
  queueEntries: readonly ReplayEntry[],
  parentMap: CommitParentMap,
  tipSha?: string,
  onProgress?: (processed: number, total: number) => void,
  progressInterval = 2000
): boolean[] {
  const count = queueEntries.length;
  if (count === 0) {
    return [];
  }

  onProgress?.(0, count);

  const tip = tipSha ?? queueEntries[count - 1]!.Sha;
  const spine = buildFirstParentSpine(parentMap, tip);
  const flags = new Array<boolean>(count);
  for (let index = 0; index < count; index++) {
    flags[index] = spine.has(queueEntries[index]!.Sha);
    if (onProgress && (index % progressInterval === 0 || index === count - 1)) {
      onProgress(index + 1, count);
    }
  }

  onProgress?.(count, count);
  return flags;
}
