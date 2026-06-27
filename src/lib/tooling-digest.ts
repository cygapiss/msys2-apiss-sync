import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Logger } from '../git/log.ts';
import { TOOLING_DIGEST_PATH } from '../types/constants.ts';

const CONFIG_DIR = 'config';
const DIGEST_FILE_NAME = 'digest.json';

function listConfigFiles(configRoot: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = relative(configRoot, full).replace(/\\/g, '/');
        if (rel === DIGEST_FILE_NAME) {
          continue;
        }
        files.push(rel);
      }
    }
  }

  walk(configRoot);
  files.sort();
  return files;
}

export function computeConfigTreeDigest(repoRoot: string): string {
  const configRoot = join(repoRoot, CONFIG_DIR);
  if (!existsSync(configRoot)) {
    throw new Error(`Missing ${CONFIG_DIR}/ directory under repo root`);
  }
  const hash = createHash('sha256');
  for (const rel of listConfigFiles(configRoot)) {
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(join(configRoot, rel)));
  }
  return hash.digest('hex');
}

export function loadDigestMap(repoRoot: string, logger?: Logger): Record<string, string> {
  const path = join(repoRoot, TOOLING_DIGEST_PATH);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('digest.json must be a JSON object');
    }
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        map[key] = value;
      }
    }
    return map;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warn = (text: string) => {
      if (logger) {
        logger.write(text, 'Warn');
      } else {
        console.warn(text);
      }
    };
    warn(`${TOOLING_DIGEST_PATH}: invalid or unreadable (${message}); treating as empty map`);
    return {};
  }
}

export function saveDigestMap(repoRoot: string, map: Record<string, string>): void {
  const path = join(repoRoot, TOOLING_DIGEST_PATH);
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(map).sort()) {
    sorted[key] = map[key]!;
  }
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

export function repoNeedsBootstrap(
  map: Record<string, string>,
  repo: string,
  digest: string
): boolean {
  return map[repo] === undefined || map[repo] !== digest;
}

export function pinRepoDigest(map: Record<string, string>, repo: string, digest: string): void {
  map[repo] = digest;
}
