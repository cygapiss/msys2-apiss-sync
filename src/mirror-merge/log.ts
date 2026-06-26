import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function convertToUnixLineEndings(text: string | null | undefined): string {
  return (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitCommitMessage(message: string | null | undefined): { Subject: string; Body: string } {
  const normalized = convertToUnixLineEndings(message).replace(/\n+$/g, '');
  if (!normalized) {
    return { Subject: '', Body: '' };
  }

  const lines = normalized.split('\n');
  const subject = lines[0] ?? '';
  if (lines.length === 1) {
    return { Subject: subject, Body: '' };
  }

  const bodyStart = lines[1] === '' ? 2 : 1;
  const body = bodyStart < lines.length ? lines.slice(bodyStart).join('\n').replace(/\s+$/g, '') : '';
  return { Subject: subject, Body: body };
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
