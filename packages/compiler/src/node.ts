// Node-only helpers for @kumikijs/compiler. Kept out of the main entrypoint so
// the compiler core stays browser-safe (no node: imports in the barrel).

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

/**
 * Parse an episode log file's contents — either a JSON array `[...]` or
 * newline-delimited JSON (one Episode per line, the format `kumiki run
 * --episode-log` writes). Surfaces malformed input as a thrown error so
 * a corrupted fixture can't silently truncate replay.
 *
 * Mirrors the compile-time `parseEpisodeLog` helper in codegen so `kumiki
 * replay` (§10.5.3) and `episode-test` (§8.6) consume logs identically.
 */
export function parseEpisodeLogText(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("episode log: JSON root must be an array");
    return arr;
  }
  const out: unknown[] = [];
  // Walk the original (non-trimmed) text so the line number we report tracks
  // the position in the file the user actually opened — leading blank lines
  // would otherwise shift the count.
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]?.trim() ?? "";
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch (e) {
      throw new Error(`episode log: invalid JSON at line ${i + 1}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Thrown when a `kumiki.caps.json` exists but is malformed. */
export class CapabilityManifestError extends Error {}

export type CapabilityLookup = {
  /** Names registered by the manifest that was found; `[]` when there was none. */
  capabilities: string[];
  /** The manifest the names came from, or `null` when none was found. */
  manifestPath: string | null;
  /** The directories consulted, nearest first — what a diagnostic reports. */
  searched: string[];
};

/** Where the search stops: a project root has a `package.json`. */
function isProjectRoot(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

/**
 * Resolve project-registered capabilities for a `.kumiki` file, searching its
 * own directory and then each parent up to (and including) the project root —
 * the directory named by `root`, or the nearest one holding a `package.json`,
 * or the filesystem root. The nearest manifest wins; the rest are not read.
 *
 * The walk exists because the manifest registers capabilities for a *project*:
 * a Vite app keeps its sources in `src/` and its config at the root, and a
 * manifest put where the rest of the project's configuration lives was
 * previously ignored without a word.
 *
 * Throws `CapabilityManifestError` (naming the path) when a manifest on the
 * path exists but is malformed — a broken manifest is never silently skipped
 * in favour of one further up.
 */
export function resolveCapabilityManifest(
  kumikiFilePath: string,
  opts: { root?: string } = {},
): CapabilityLookup {
  const stopAt = opts.root ? resolve(opts.root) : null;
  const searched: string[] = [];
  let dir = dirname(resolve(kumikiFilePath));
  for (;;) {
    searched.push(dir);
    const manifestPath = join(dir, "kumiki.caps.json");
    if (existsSync(manifestPath)) {
      return { capabilities: readManifest(manifestPath), manifestPath, searched };
    }
    const parent = dirname(dir);
    const atStop = stopAt ? dir === stopAt : isProjectRoot(dir);
    if (atStop || parent === dir) return { capabilities: [], manifestPath: null, searched };
    dir = parent;
  }
}

function readManifest(manifestPath: string): string[] {
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

/**
 * One line saying where a capability lookup got its names, or where it looked
 * and found nothing. What `E0302 unknown-capability` is missing on its own:
 * the fix is a file, and the author cannot see from the code which file the
 * toolchain would read.
 */
export function describeCapabilitySearch(lookup: CapabilityLookup): string {
  return lookup.manifestPath
    ? `registered capabilities come from ${lookup.manifestPath}`
    : `no kumiki.caps.json found (searched: ${lookup.searched.join(", ")})`;
}

/**
 * The registered capability names for a `.kumiki` file — {@link
 * resolveCapabilityManifest} without the provenance. Pass the result as
 * `compile(src, { capabilities })` / `check(program, { capabilities })`.
 */
export function resolveCapabilities(
  kumikiFilePath: string,
  opts: { root?: string } = {},
): string[] {
  return resolveCapabilityManifest(kumikiFilePath, opts).capabilities;
}

/**
 * Resolve `@kumikijs/icons` from the project containing `kumikiFilePath` and
 * return its full `ALL_ICONS` registry (#101). When the package is not
 * installed (or its shape is unexpected) returns `null` — callers fall back
 * to whatever was set via `theme.icons`. Resolution is cached per project root
 * so repeated compiles in a long-lived process (Vite dev server, MCP) don't
 * pay the dynamic-import cost on every transform.
 *
 * Cache lifetime: process. Installing / removing `@kumikijs/icons` while a
 * Vite dev server (or MCP) is running won't be picked up until restart — the
 * trade-off for amortizing the dynamic import across every `.kumiki` save.
 */
const ICON_REGISTRY_CACHE = new Map<string, Record<string, string> | null>();
export async function resolveBuiltinIcons(
  kumikiFilePath: string,
): Promise<Record<string, string> | null> {
  const baseDir = dirname(kumikiFilePath);
  if (ICON_REGISTRY_CACHE.has(baseDir)) return ICON_REGISTRY_CACHE.get(baseDir) ?? null;
  let resolved: string;
  try {
    const require = createRequire(join(baseDir, "_"));
    resolved = require.resolve("@kumikijs/icons");
  } catch (e) {
    // MODULE_NOT_FOUND is the only signal we treat as "genuinely not installed"
    // — that path is the documented standalone mode (style.md §4.8.3). Any
    // other resolve failure (broken install, permission, mid-install) gets
    // reported so a strict-icons run can't masquerade a broken package as a
    // theme.icons-only domain.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "MODULE_NOT_FOUND") {
      console.error(`@kumikijs/icons resolution failed: ${(e as Error).message}`);
    }
    ICON_REGISTRY_CACHE.set(baseDir, null);
    return null;
  }
  try {
    const mod = (await import(pathToFileURL(resolved).href)) as {
      ALL_ICONS?: Record<string, unknown>;
    };
    const all = mod.ALL_ICONS;
    if (!all || typeof all !== "object") {
      console.error(`@kumikijs/icons at ${resolved}: missing or invalid ALL_ICONS export`);
      ICON_REGISTRY_CACHE.set(baseDir, null);
      return null;
    }
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(all)) {
      if (typeof v === "string") filtered[k] = v;
    }
    ICON_REGISTRY_CACHE.set(baseDir, filtered);
    return filtered;
  } catch (e) {
    // The package resolved but importing it threw (SyntaxError, missing
    // transitive dep, ESM/CJS mismatch). Surface to stderr; caching null
    // prevents repeat retries within the same process.
    console.error(`@kumikijs/icons import failed: ${(e as Error).message}`);
    ICON_REGISTRY_CACHE.set(baseDir, null);
    return null;
  }
}
