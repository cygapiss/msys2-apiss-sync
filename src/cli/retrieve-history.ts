import { join } from 'node:path';

import { getSyncRepoRoot, loadSyncConfig, resolveSourcesForCli } from '../lib/config.ts';
import { getMirrorTipSha, getSourceReplayHistory } from '../lib/history.ts';
import { createSyncLogger, getWorkDirectory, setSyncUtf8Environment, writeJsonFile } from '../lib/log.ts';
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
    const sourceOption = readStringOption(args, '--source-key') ?? 'all';
    const sources = resolveSourcesForCli(config, sourceOption);
    const afterSha = readStringOption(args, '--after-sha') ?? null;
    const skipFetch = readFlag(args, '--skip-fetch');
    const saveFullJson = readFlag(args, '--save-full-json');
    const sampleCount = readIntOption(args, '--sample-count', 3);

    logger.write(
      `Retrieving history (sources=${sourceOption} after=${afterSha ? afterSha.slice(0, 8) : 'full'})`
    );

    for (const source of sources) {
      const mirrorPath = initializeMirrorRepository({
        WorkDirectory: work,
        Source: source,
        Config: config,
        SkipFetch: skipFetch,
        Logger: logger
      });
      const tip = getMirrorTipSha(mirrorPath, source.Branch);
      const history = await getSourceReplayHistory(source.SortKey, config, mirrorPath, afterSha, tip);
      const outFile = join(outDir, `history-${source.SortKey}.json`);
      const fullFile = saveFullJson ? join(outDir, `history-${source.SortKey}-full.json`) : null;

      if (saveFullJson) {
        writeJsonFile(fullFile!, history.map(({ Sha, SourceId, CommitterDateUnix, AuthorDateUnix, AuthorName, AuthorEmail, CommitterName, CommitterEmail, Subject, Body }) => ({
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

      writeJsonFile(outFile, {
        SortKey: source.SortKey,
        MirrorPath: mirrorPath,
        AfterSha: afterSha,
        UntilSha: tip,
        Count: history.length,
        OldestSha: history.length > 0 ? history[0]!.Sha : null,
        NewestSha: history.length > 0 ? history[history.length - 1]!.Sha : null,
        FullHistoryFile: fullFile,
        Sample: history.slice(0, sampleCount).map((entry) => ({
          Sha: entry.Sha,
          CommitterDateUnix: entry.CommitterDateUnix,
          Subject: entry.Subject
        }))
      });

      logger.write(`${source.SortKey}: ${history.length} commit(s) (${tip.slice(0, 8)} tip) -> ${outFile}`);
      if (fullFile) {
        logger.write(`  full history -> ${fullFile}`);
      }
      if (history.length > 0) {
        logger.write(`  oldest: ${history[0]!.Sha.slice(0, 8)} ${history[0]!.Subject}`);
        logger.write(`  newest: ${history[history.length - 1]!.Sha.slice(0, 8)} ${history[history.length - 1]!.Subject}`);
      }
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
