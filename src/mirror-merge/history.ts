import type { ReplayEntry, UpstreamLogEntry } from './replay-entry.ts';
import type { SyncConfig } from './config.ts';
import { getSourceConfigEntry } from './config.ts';
import { convertToUnixLineEndings, splitCommitMessage } from './log.ts';
import { runGitText, streamGitText } from '../git/index.ts';

export function getUpstreamCommitLogMetadataFormat(): string {
  return '%H%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B%x1e';
}

export function convertFromUpstreamCommitLogMetadataText(text: string): UpstreamLogEntry[] {
  const normalized = convertToUnixLineEndings(text).trim();
  if (!normalized) {
    return [];
  }

  const recordSep = String.fromCharCode(0x1e);
  const fieldSep = String.fromCharCode(0x1f);
  const entries: UpstreamLogEntry[] = [];

  for (const rawRecord of normalized.split(recordSep)) {
    const record = rawRecord.trim();
    if (!record) {
      continue;
    }

    const parts = record.split(fieldSep);
    if (parts.length < 8) {
      const preview = record.slice(0, 120);
      throw new Error(`Invalid upstream commit log record (expected 8 fields, got ${parts.length}): ${preview}`);
    }

    const message = parts.slice(7).join(fieldSep).replace(/\n+$/g, '');
    const split = splitCommitMessage(message);
    entries.push({
      Sha: parts[0]!,
      AuthorDateUnix: Number(parts[3]),
      CommitterDateUnix: Number(parts[6]),
      AuthorName: parts[1]!,
      AuthorEmail: parts[2]!,
      CommitterName: parts[4]!,
      CommitterEmail: parts[5]!,
      Subject: split.Subject,
      Body: split.Body
    });
  }

  return entries;
}

export async function exportUpstreamCommitLogRawText(
  mirrorPath: string,
  afterSha: string | null,
  untilSha: string,
  branch = 'master'
): Promise<string> {
  const range = afterSha ? `${afterSha}..${untilSha}` : untilSha;
  const text = await streamGitText(mirrorPath, ['log', '--reverse', `--format=${getUpstreamCommitLogMetadataFormat()}`, range]);
  return convertToUnixLineEndings(text).trim();
}

export function getMirrorTipSha(mirrorPath: string, branch = 'master'): string {
  try {
    return runGitText(mirrorPath, ['rev-parse', `origin/${branch}`]).trim();
  } catch {
    return runGitText(mirrorPath, ['rev-parse', branch]).trim();
  }
}

export function resolveMirrorContentBranchRef(mirrorPath: string, branch: string): string {
  const originRef = `origin/${branch}`;
  try {
    runGitText(mirrorPath, ['rev-parse', '--verify', originRef]);
    return originRef;
  } catch {
    return branch;
  }
}

export function newReplayCommitEntry(
  sourceId: string,
  logEntry: UpstreamLogEntry,
  config: SyncConfig
): ReplayEntry {
  const sourceEntry = getSourceConfigEntry(config, sourceId);
  return {
    Sha: logEntry.Sha,
    SourceId: sourceEntry.SortKey,
    SortKey: sourceEntry.SortKey,
    DestSubdir: sourceEntry.DestSubdir,
    UpstreamRepo: sourceEntry.UpstreamRepo,
    CommitterDateUnix: logEntry.CommitterDateUnix,
    AuthorDateUnix: logEntry.AuthorDateUnix,
    AuthorName: logEntry.AuthorName,
    AuthorEmail: logEntry.AuthorEmail,
    CommitterName: logEntry.CommitterName,
    CommitterEmail: logEntry.CommitterEmail,
    Subject: logEntry.Subject,
    Body: logEntry.Body
  };
}

export async function getSourceReplayHistory(
  sourceId: string,
  config: SyncConfig,
  mirrorPath: string,
  afterSha: string | null,
  untilSha: string
): Promise<ReplayEntry[]> {
  const sourceEntry = getSourceConfigEntry(config, sourceId);
  const text = await exportUpstreamCommitLogRawText(mirrorPath, afterSha, untilSha, sourceEntry.Branch);
  return convertFromUpstreamCommitLogMetadataText(text).map((entry) => newReplayCommitEntry(sourceId, entry, config));
}
