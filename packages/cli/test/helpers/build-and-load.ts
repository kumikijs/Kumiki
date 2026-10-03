import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";

const here = dirname(fileURLToPath(import.meta.url));
// Temp bundles go under test-tmp/ as `app.mjs`: vitest.config.ts externalizes
// that path, so Node imports them without Vite transforming each one.
const TMP_ROOT = resolve(here, "../../test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

/**
 * Compile a .kumiki file as a self-contained bundle, write it to a temp file,
 * and dynamic-import it. Sets `globalThis.__kumikiApp` and returns it.
 *
 * Each call uses a fresh temp file + query-string cache-bust so tests don't
 * share module state.
 */
export async function buildAndLoad(kumikiPath: string, rootId: string): Promise<AppShape> {
  const src = readFileSync(kumikiPath, "utf8");
  const result = compile(src, {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
  });
  if (result.kind !== "ok") {
    const summary = result.errors.map((e) => `${e.code} ${e.message}`).join("\n");
    throw new Error(`compile failed:\n${summary}`);
  }

  // Patch the bottom of the bundle so it stops at `globalThis.__kumikiApp = App`
  // instead of mounting to a hard-coded "#root" we don't own in tests.
  const patched = result.js
    .replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "")
    .replace(
      /globalThis\.__kumikiApp = App;/,
      `globalThis.__kumikiApp = App; globalThis.__kumikiRootId = ${JSON.stringify(rootId)};`,
    );

  const dir = mkdtempSync(join(TMP_ROOT, "e2e-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);

  const url = `${pathToFileURL(file).href}?t=${Date.now()}_${Math.random()}`;
  await import(/* @vite-ignore */ url);

  const app = (globalThis as unknown as { __kumikiApp?: AppShape }).__kumikiApp;
  if (!app) throw new Error("Generated bundle did not expose __kumikiApp");
  return app;
}
