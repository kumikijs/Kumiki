import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadApp as cliLoadApp } from "@kumikijs/cli";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveCapabilities } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";

const here = dirname(fileURLToPath(import.meta.url));
export const TMP_ROOT = join(here, "..", "..", ".smoke-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

export async function loadApp(kumikiPath: string): Promise<AppShape> {
  return cliLoadApp(readFileSync(kumikiPath, "utf8"), resolveCapabilities(kumikiPath), {
    sourcePath: kumikiPath,
    moduleDir: TMP_ROOT,
  });
}

/**
 * The same pipeline from a source string rather than a file. Tests that vary one prop at a time need the source in the test body, next to what it asserts about the DOM — a fixture file per row would put the two halves of the claim in different files.
 */
export async function loadSource(src: string, capabilities: string[] = []): Promise<AppShape> {
  return cliLoadApp(src, capabilities, { moduleDir: TMP_ROOT });
}

/**
 * The compiled module's `createApp`, for tests that need two independent instances of one app — `loadApp` hands back only the default instance.
 */
export async function loadFactory(kumikiPath: string): Promise<() => AppShape> {
  const result = compile(readFileSync(kumikiPath, "utf8"), {
    runtimeSpecifier: "ignored",
    bundle: true,
    exportApp: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities: resolveCapabilities(kumikiPath),
  });
  if (result.kind !== "ok") {
    throw new Error(result.errors.map((e) => `${e.code} ${e.message}`).join(", "));
  }
  const file = join(mkdtempSync(join(TMP_ROOT, "factory-")), "app.mjs");
  writeFileSync(file, result.js);
  const mod: { createApp: () => AppShape } = await import(pathToFileURL(file).href);
  return mod.createApp;
}

/** Write `source` to `<name>.kumiki` under the scratch directory, for APIs that take a path. */
export function writeSource(name: string, source: string): string {
  const path = join(TMP_ROOT, `${name}.kumiki`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  return path;
}
