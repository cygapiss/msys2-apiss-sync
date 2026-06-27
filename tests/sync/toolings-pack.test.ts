import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

import { getSyncRepoRoot } from '../../src/mirror-init/config.ts';
import {
  bundledTemplateExists,
  bundledTemplatePath,
  MIRROR_MERGE_BUNDLE_FILE,
  MIRROR_SYNC_BUNDLE_FILE
} from '../../src/mirror-init/toolings.ts';
import {
  MIRROR_MERGE_BUNDLE_URL,
  MIRROR_MERGE_CONFIG_URL,
  MIRROR_SYNC_BUNDLE_URL,
  MIRROR_SYNC_CONFIG_DIR,
  TOOLING_REPO_RAW_BASE
} from '../../src/types/constants.ts';

describe('pack-toolings bundles', () => {
  test('prebuilt mirror-sync and mirror-merge mjs exist', () => {
    const repoRoot = getSyncRepoRoot();
    expect(bundledTemplateExists(repoRoot, MIRROR_SYNC_BUNDLE_FILE)).toBe(true);
    expect(bundledTemplateExists(repoRoot, MIRROR_MERGE_BUNDLE_FILE)).toBe(true);
    expect(bundledTemplatePath(repoRoot, MIRROR_SYNC_BUNDLE_FILE)).toMatch(/mirror-sync\.mjs$/);
    expect(bundledTemplatePath(repoRoot, MIRROR_MERGE_BUNDLE_FILE)).toMatch(/mirror-merge\.mjs$/);
  });

  test('workflow templates download toolings from absolute raw URLs', () => {
    const repoRoot = getSyncRepoRoot();
    const syncYml = readFileSync(join(repoRoot, 'config/mirror-template/mirror-sync.yml'), 'utf8');
    const mergeYml = readFileSync(join(repoRoot, 'config/mirror-template/mirror-merge.yml'), 'utf8');
    expect(syncYml).toContain(MIRROR_SYNC_BUNDLE_URL);
    expect(syncYml).toContain(`${TOOLING_REPO_RAW_BASE}/${MIRROR_SYNC_CONFIG_DIR}/`);
    expect(syncYml).toContain('github.event.repository.name');
    expect(mergeYml).toContain(MIRROR_MERGE_BUNDLE_URL);
    expect(mergeYml).toContain(MIRROR_MERGE_CONFIG_URL);
  });

  test('mirror-merge bundle prints help', () => {
    const bundle = bundledTemplatePath(getSyncRepoRoot(), MIRROR_MERGE_BUNDLE_FILE);
    const result = spawnSync(process.execPath, [bundle, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('mirror-merge');
  });
});
