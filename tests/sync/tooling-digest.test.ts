import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import type { Logger } from '../../src/git/log.ts';
import {
  computeConfigTreeDigest,
  loadDigestMap,
  pinRepoDigest,
  repoNeedsBootstrap,
  saveDigestMap
} from '../../src/lib/tooling-digest.ts';
import { TOOLING_DIGEST_PATH } from '../../src/types/constants.ts';

function writeConfigTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, 'config', rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
}

describe('computeConfigTreeDigest', () => {
  test('hashes sorted paths with null separator and excludes digest.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-'));
    try {
      writeConfigTree(root, {
        'b.txt': 'two',
        'a/nested.txt': 'one'
      });
      writeFileSync(join(root, 'config', 'digest.json'), '{"ignored":true}\n', 'utf8');

      const expected = createHash('sha256');
      expected.update('a/nested.txt');
      expected.update('\0');
      expected.update('one');
      expected.update('b.txt');
      expected.update('\0');
      expected.update('two');

      expect(computeConfigTreeDigest(root)).toBe(expected.digest('hex'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('order is stable regardless of write order', () => {
    const rootA = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-a-'));
    const rootB = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-b-'));
    try {
      writeConfigTree(rootA, { 'z.txt': 'z', 'a.txt': 'a' });
      writeConfigTree(rootB, { 'a.txt': 'a', 'z.txt': 'z' });
      expect(computeConfigTreeDigest(rootA)).toBe(computeConfigTreeDigest(rootB));
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });
});

describe('loadDigestMap', () => {
  test('returns empty map when digest.json is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-load-'));
    try {
      mkdirSync(join(root, 'config'), { recursive: true });
      expect(loadDigestMap(root)).toEqual({});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('loads repo entries from digest.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-load2-'));
    try {
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(
        join(root, TOOLING_DIGEST_PATH),
        '{"MSYS2-packages":"abc","msys2-apiss":"def"}\n',
        'utf8'
      );
      expect(loadDigestMap(root)).toEqual({
        'MSYS2-packages': 'abc',
        'msys2-apiss': 'def'
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('warns and returns empty map on invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-invalid-'));
    try {
      mkdirSync(join(root, 'config'), { recursive: true });
      writeFileSync(join(root, TOOLING_DIGEST_PATH), 'not-json', 'utf8');
      const warnings: string[] = [];
      const logger: Logger = {
        write(message, level) {
          if (level === 'Warn') {
            warnings.push(message);
          }
        },
        close() {}
      };
      expect(loadDigestMap(root, logger)).toEqual({});
      expect(warnings.some((line) => line.includes('treating as empty map'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('saveDigestMap', () => {
  test('writes sorted keys with trailing newline', () => {
    const root = mkdtempSync(join(tmpdir(), 'msys2-apiss-sync-digest-save-'));
    try {
      mkdirSync(join(root, 'config'), { recursive: true });
      saveDigestMap(root, { b: '2', a: '1' });
      const path = join(root, TOOLING_DIGEST_PATH);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe('{\n  "a": "1",\n  "b": "2"\n}\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('repoNeedsBootstrap', () => {
  test('true when repo key missing or digest differs', () => {
    const map = { pinned: 'abc' };
    expect(repoNeedsBootstrap(map, 'pinned', 'abc')).toBe(false);
    expect(repoNeedsBootstrap(map, 'pinned', 'def')).toBe(true);
    expect(repoNeedsBootstrap(map, 'new-repo', 'abc')).toBe(true);
    expect(repoNeedsBootstrap({}, 'any', 'abc')).toBe(true);
  });
});

describe('pinRepoDigest', () => {
  test('sets repo digest in map', () => {
    const map: Record<string, string> = {};
    pinRepoDigest(map, 'elfutils', 'deadbeef');
    expect(map).toEqual({ elfutils: 'deadbeef' });
  });
});
