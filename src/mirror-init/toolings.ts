import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  MIRROR_MERGE_BUNDLE,
  MIRROR_SYNC_BUNDLE,
  MIRROR_TOOLINGS_TEMPLATE_DIR
} from '../types/constants.ts';

export function bundledTemplatePath(repoRoot: string, bundleFileName: string): string {
  return join(repoRoot, MIRROR_TOOLINGS_TEMPLATE_DIR, bundleFileName);
}

export function bundledTemplateExists(repoRoot: string, bundleFileName: string): boolean {
  const path = bundledTemplatePath(repoRoot, bundleFileName);
  return existsSync(path) && statSync(path).isFile();
}

export const MIRROR_SYNC_BUNDLE_FILE = MIRROR_SYNC_BUNDLE;
export const MIRROR_MERGE_BUNDLE_FILE = MIRROR_MERGE_BUNDLE;
