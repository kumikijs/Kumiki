import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = resolve(here, "../../test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

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
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    // The bundle imports nothing, so nothing reads the file once it has loaded.
    rmSync(dir, { recursive: true, force: true });
  }

  const app = (globalThis as unknown as { __kumikiApp?: AppShape }).__kumikiApp;
  if (!app) throw new Error("Generated bundle did not expose __kumikiApp");
  return app;
}
