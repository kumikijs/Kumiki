// Node-only helpers for @kumikijs/compiler. Kept out of the main entrypoint so
// the compiler core stays browser-safe (no node: imports in the barrel).

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseCapabilityManifest } from "./capabilities.ts";

/**
 * Reads the prebuilt @kumikijs/runtime bundle from disk. Pass as
 * `compile(source, { bundle: true, readRuntimeBundle: nodeRuntimeBundleReader })`.
 */
export function nodeRuntimeBundleReader(): string {
  const require = createRequire(import.meta.url);
  const runtimeBundlePath = require.resolve("@kumikijs/runtime/bundle");
  return readFileSync(runtimeBundlePath, "utf8");
}

/**
 * Build an `episode-test` reader rooted at the directory containing the
 * source `.kumiki` file. Each `load = "<path>"` is resolved relative to that
 * directory so fixtures live next to the test that uses them, matching how
 * `load` is intuitively read.
 */
export function nodeEpisodeLogReader(kumikiFilePath: string): (relPath: string) => string {
  const baseDir = dirname(kumikiFilePath);
  return (relPath: string) => readFileSync(join(baseDir, relPath), "utf8");
}

/** Thrown when a `kumiki.caps.json` exists but is malformed. */
export class CapabilityManifestError extends Error {}

/**
 * Resolve project-registered capabilities from a `kumiki.caps.json` in the same
 * directory as the given `.kumiki` file. Returns `[]` when no manifest exists;
 * throws `CapabilityManifestError` (with the path) when one exists but is
 * invalid. Pass the result as `compile(src, { capabilities })` /
 * `check(program, { capabilities })`.
 */
export function resolveCapabilities(kumikiFilePath: string): string[] {
  const manifestPath = join(dirname(kumikiFilePath), "kumiki.caps.json");
  if (!existsSync(manifestPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new CapabilityManifestError(`${manifestPath}: invalid JSON — ${(e as Error).message}`);
  }
  const result = parseCapabilityManifest(raw);
  if (!result.ok) throw new CapabilityManifestError(`${manifestPath}: ${result.error}`);
  return result.manifest.capabilities;
}
