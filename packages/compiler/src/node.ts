import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCapabilityManifest } from "./capabilities.ts";

export function nodeRuntimeBundleReader(): string {
  const require = createRequire(import.meta.url);
  const runtimeBundlePath = require.resolve("@kumikijs/runtime/bundle");
  return readFileSync(runtimeBundlePath, "utf8");
}

export function nodeEpisodeLogReader(kumikiFilePath: string): (relPath: string) => string {
  const baseDir = dirname(kumikiFilePath);
  return (relPath: string) => readFileSync(join(baseDir, relPath), "utf8");
}

export function parseEpisodeLogText(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("episode log: JSON root must be an array");
    return arr;
  }
  const out: unknown[] = [];
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
  /** The directories consulted, nearest first — what a diagnostic reports. */
  searched: string[];
} & ({ manifestPath: string; capabilities: string[] } | { manifestPath: null; capabilities: [] });

/** Where the search stops: a project root has a `package.json`. */
function isProjectRoot(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

export function resolveCapabilityManifest(kumikiFilePath: string): CapabilityLookup {
  const searched: string[] = [];
  let dir = dirname(resolve(kumikiFilePath));
  for (;;) {
    searched.push(dir);
    const manifestPath = join(dir, "kumiki.caps.json");
    if (existsSync(manifestPath)) {
      return { capabilities: readManifest(manifestPath), manifestPath, searched };
    }
    const parent = dirname(dir);
    if (isProjectRoot(dir) || parent === dir) {
      return { capabilities: [], manifestPath: null, searched };
    }
    dir = parent;
  }
}

function readManifest(manifestPath: string): string[] {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (e) {
    throw new CapabilityManifestError(`${manifestPath}: cannot read — ${(e as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CapabilityManifestError(`${manifestPath}: invalid JSON — ${(e as Error).message}`);
  }
  const result = parseCapabilityManifest(raw);
  if (!result.ok) throw new CapabilityManifestError(`${manifestPath}: ${result.error}`);
  return result.manifest.capabilities;
}

export function describeCapabilitySearch(lookup: CapabilityLookup): string {
  return lookup.manifestPath === null
    ? `no kumiki.caps.json found (searched: ${lookup.searched.join(", ")})`
    : `registered capabilities come from ${lookup.manifestPath}`;
}

export function resolveCapabilities(kumikiFilePath: string): string[] {
  return resolveCapabilityManifest(kumikiFilePath).capabilities;
}

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
    console.error(`@kumikijs/icons import failed: ${(e as Error).message}`);
    ICON_REGISTRY_CACHE.set(baseDir, null);
    return null;
  }
}
