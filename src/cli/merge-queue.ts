import { join } from 'node:path';

import { getSyncRepoRoot, loadSyncConfig, resolveSourcesForCli } from '../lib/config.ts';
import { getMirrorTipSha, getSourceReplayHistory } from '../lib/history.ts';
import { createSyncLogger, getWorkDirectory, setSyncUtf8Environment, writeJsonFile } from '../lib/log.ts';
import { mergeReplayCommitQueues } from '../lib/queue.ts';
import { initializeMirrorRepository } from '../lib/repos.ts';
import { readFlag, readIntOption, readStringOption } from './args.ts';

async function main(): Promise<void> {
  setSyncUtf8Environment();
  const args = process.argv.slice(2);
  const repoRoot = getSyncRepoRoot();
  const config = loadSyncConfig(repoRoot);
  const logger = createSyncLogger(repoRoot);

  try {
    const work = getWorkDirectory(repoRoot);
    const outDir = join(work, 'cache', 'replay-log');
    const afterSha = readStringOption(args, '--after-sha') ?? null;
    const skipFetch = readFlag(args, '--skip-fetch');
    const saveFullJson = readFlag(args, '--save-full-json');
    const sampleCount = readIntOption(args, '--sample-count', 5);

    logger.write(`Merging queue (after=${afterSha ? afterSha.slice(0, 8) : 'full'})`);

    const historyLists = await Promise.all(
      config.Sources.map(async (source) => {
        const mirrorPath = initializeMirrorRepository({
          WorkDirectory: work,
          Source: source,
          Config: config,
          SkipFetch: skipFetch,
          Logger: logger
        });
        const tip = getMirrorTipSha(mirrorPath, source.Branch);
        const history = await getSourceReplayHistory(source.SortKey, config, mirrorPath, afterSha, tip);
        logger.write(`${source.SortKey}: ${history.length} commit(s)`);
        return history;
      })
    );
    const queue = mergeReplayCommitQueues(...historyLists);

    logger.write(`merged: ${queue.length}`);
    for (const entry of queue.slice(0, sampleCount)) {
      console.log(`${entry.SourceId}\t${entry.Sha.slice(0, 8)}\t${entry.CommitterDateUnix}\t${entry.Subject}`);
    }

    const outFile = join(outDir, 'merged-queue-summary.json');
    const fullFile = saveFullJson ? join(outDir, 'merged-queue-full.json') : null;
    if (saveFullJson) {
      writeJsonFile(fullFile!, queue.map(({ Sha, SourceId, CommitterDateUnix, AuthorDateUnix, AuthorName, AuthorEmail, CommitterName, CommitterEmail, Subject, Body }) => ({
        Sha,
        SourceId,
        CommitterDateUnix,
        AuthorDateUnix,
        AuthorName,
        AuthorEmail,
        CommitterName,
        CommitterEmail,
        Subject,
        Body
      })));
    }

    const sourceCounts = Object.fromEntries(
      config.Sources.map((source, index) => [source.SortKey, historyLists[index]!.length])
    );
    writeJsonFile(outFile, {
      SourceCounts: sourceCounts,
      MergedCount: queue.length,
      FullHistoryFile: fullFile,
      Sample: queue.slice(0, sampleCount).map((entry) => ({
        SourceId: entry.SourceId,
        Sha: entry.Sha,
        CommitterDateUnix: entry.CommitterDateUnix,
        Subject: entry.Subject
      }))
    });

    logger.write(`summary -> ${outFile}`);
    if (fullFile) {
      logger.write(`full queue -> ${fullFile}`);
    }
    logger.write('Done.');
  } catch (error) {
    logger.write(error instanceof Error ? error.message : String(error), 'Error');
    process.exitCode = 1;
  } finally {
    logger.close();
  }
}

void main();
