// A real `vite build` of a throwaway project: one `.kumiki` file and the
// entry that imports it.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { type KumikiPluginOptions, kumiki } from "../../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TMP = join(here, "..", "test-tmp");
mkdirSync(TMP, { recursive: true });

/**
 * Build a one-entry project — `app` as `src/app.kumiki`, `main` as
 * `src/main.ts` — and return the concatenated output. `where` is the directory
 * the project is created under: inside the workspace by default, where
 * `@kumikijs/runtime` resolves from the project itself.
 */
export async function buildProject(
  app: string,
  main: string,
  opts?: KumikiPluginOptions,
  where: string = TMP,
): Promise<string> {
  const root = mkdtempSync(join(where, "build-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.kumiki"), app);
  writeFileSync(join(root, "src", "main.ts"), main);
  await build({
    root,
    logLevel: "silent",
    plugins: [kumiki(opts)],
    build: {
      outDir: join(root, "dist"),
      emptyOutDir: true,
      lib: { entry: join(root, "src", "main.ts"), formats: ["es"], fileName: "out" },
      minify: false,
    },
  });
  const outDir = join(root, "dist");
  return readdirSync(outDir)
    .map((f) => readFileSync(join(outDir, f), "utf8"))
    .join("\n");
}
