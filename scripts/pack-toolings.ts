import { resolve } from 'node:path';
import { builtinModules } from 'node:module';

import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'config/mirror-template/toolings');
const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

async function packTooling(entryName: string, entryPath: string, emptyOutDir: boolean): Promise<void> {
  await build({
    build: {
      outDir,
      emptyOutDir,
      lib: {
        entry: resolve(root, entryPath),
        formats: ['es'],
        fileName: () => `${entryName}.mjs`
      },
      rollupOptions: {
        external: nodeBuiltins,
        output: { codeSplitting: false }
      },
      target: 'node20',
      minify: false,
      sourcemap: false
    }
  });
}

await packTooling('mirror-sync', 'src/mirror-sync/cli.ts', true);
await packTooling('mirror-merge', 'src/mirror-merge/cli.ts', false);
