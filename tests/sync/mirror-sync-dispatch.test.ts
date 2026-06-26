import { describe, expect, test } from 'vitest';

import { mirrorSyncReadyState } from '../../src/lib/mirror-sync-dispatch.ts';

describe('mirrorSyncReadyState', () => {
  test('normal when workflow registered', () => {
    expect(mirrorSyncReadyState({ WorkflowRegistered: true })).toBe('normal');
  });

  test('bootstrap when workflow not registered', () => {
    expect(mirrorSyncReadyState({ WorkflowRegistered: false })).toBe('bootstrap');
  });
});
