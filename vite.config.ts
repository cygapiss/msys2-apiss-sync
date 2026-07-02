import { resolve } from "node:path";
import { builtinModules } from "node:module";

import { defineConfig } from "vitest/config";
import type { UserConfig } from "vite";

const root = import.meta.dirname;
const outDir = resolve(root, "config/mirror-template/toolings");
const nodeBuiltins = [...builtinModules, ...builtinModules.map((name) => `node:${name}`)];

function toolingConfig(entryName: string, entryPath: string, emptyOutDir: boolean): UserConfig {
  return {
    build: {
      outDir,
      emptyOutDir,
      lib: {
        entry: resolve(root, entryPath),
        formats: ["es"],
        fileName: () => `${entryName}.mjs`,
      },
      rollupOptions: {
        external: nodeBuiltins,
        output: { codeSplitting: false },
      },
      target: "node20",
      minify: false,
      sourcemap: false,
    },
  };
}

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    if (mode === "mirror-sync") {
      return toolingConfig("mirror-sync", "src/mirror-sync/cli.ts", true);
    }
    if (mode === "mirror-merge") {
      return toolingConfig("mirror-merge", "src/mirror-merge/cli.ts", false);
    }
    throw new Error("vite.config.ts: use --mode mirror-sync or --mode mirror-merge for yarn run pack");
  }

  return {
    test: {
      environment: "node",
      include: ["tests/sync/**/*.test.ts"],
    },
  };
});
