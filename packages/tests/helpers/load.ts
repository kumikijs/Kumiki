// Compile a .kumiki file to a self-contained module, import it, and return the
// AppShape it exposes (without auto-mounting). Mirrors the CLI's build-and-load
// helper so the smoke tests can mount apps under their own control.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import { nodeRuntimeBundleReader, resolveCapabilities } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = join(here, "..", ".smoke-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

export async function loadApp(kumikiPath: string): Promise<AppShape> {
  return loadSource(readFileSync(kumikiPath, "utf8"), resolveCapabilities(kumikiPath));
}

/**
 * The same pipeline from a source string rather than a file. Tests that vary
 * one prop at a time need the source in the test body, next to what it asserts
 * about the DOM — a fixture file per row would put the two halves of the claim
 * in different files.
 */
export async function loadSource(src: string, capabilities: string[] = []): Promise<AppShape> {
  const result = compile(src, {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities,
  });
  if (result.kind !== "ok") {
    throw new Error(
      `compile failed: ${result.errors.map((e) => `${e.code} ${e.message}`).join(", ")}`,
    );
  }
  // Stop the bundle at `globalThis.__kumikiApp = App` instead of auto-mounting.
  // (The auto-mount line may carry a trailing options arg, e.g. `{ providers }`.)
  const patched = result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "");

  const dir = mkdtempSync(join(TMP_ROOT, "app-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  const url = `${pathToFileURL(file).href}?t=${Date.now()}`;
  await import(/* @vite-ignore */ url);

  const app = (globalThis as unknown as { __kumikiApp?: AppShape }).__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return app;
}
