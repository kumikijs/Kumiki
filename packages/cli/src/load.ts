import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, type KumikiError } from "@kumikijs/compiler";
import { nodeEpisodeLogReader, nodeRuntimeBundleReader } from "@kumikijs/compiler/node";
import type { AppShape } from "@kumikijs/runtime";
import { formatDiagnostic } from "./diagnostic.ts";
import { installTestDoubles } from "./harness.ts";
import { builtinIconSubset } from "./icons.ts";
import { loadSource } from "./store.ts";

let domReady: Promise<void> | null = null;
export function ensureDom(): Promise<void> {
  domReady ??= registerDom().catch((err: unknown) => {
    // A failed import must not poison every later call.
    domReady = null;
    throw err;
  });
  return domReady;
}

async function registerDom(): Promise<void> {
  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  GlobalRegistrator.register({ url: "http://localhost/" });
  installTestDoubles();
}

export type LoadedApp = AppShape & { live: Record<string, unknown> };

type LoadOptions = { includeTests?: boolean; sourcePath?: string; moduleDir?: string };

export async function loadApp(
  source: string,
  capabilities: string[] = [],
  opts: LoadOptions = {},
): Promise<LoadedApp> {
  return (await compileForLoad(source, capabilities, opts)).app;
}

export async function compileForLoad(
  source: string,
  capabilities: string[],
  opts: LoadOptions,
): Promise<{ app: LoadedApp; warnings: KumikiError[] }> {
  const baseOpts = {
    runtimeSpecifier: "ignored",
    bundle: true,
    readRuntimeBundle: nodeRuntimeBundleReader,
    capabilities,
    includeTests: opts.includeTests === true,
    ...(opts.sourcePath ? { readEpisodeLog: nodeEpisodeLogReader(opts.sourcePath) } : {}),
  } as const;
  const first = compile(source, baseOpts);
  if (first.kind !== "ok") {
    throw new Error(compileFailure(source, [...first.warnings, ...first.errors], opts.sourcePath));
  }

  let result = first;
  const icons = opts.sourcePath ? await builtinIconSubset(opts.sourcePath, first.usedIcons) : null;
  if (icons) {
    const second = compile(source, { ...baseOpts, icons });
    if (second.kind === "ok") result = second;
  }

  const patched = result.js.replace(/mount\(App, document\.getElementById\("root"\)[^;]*\);?/, "");
  const dir = mkdtempSync(join(opts.moduleDir ?? tmpdir(), "kumiki-smoke-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, patched);
  await import(pathToFileURL(file).href);
  const app = (globalThis as unknown as { __kumikiApp?: LoadedApp }).__kumikiApp;
  if (!app) throw new Error("compiled module did not expose __kumikiApp");
  return { app, warnings: result.warnings };
}

function compileFailure(source: string, diagnostics: KumikiError[], sourcePath?: string): string {
  const lines = diagnosticLines(source, diagnostics);
  return `compile failed${sourcePath ? ` (${sourcePath})` : ""}:\n${lines.join("\n")}`;
}

/** Each diagnostic of a `compile` of `source`, with the `test` it sits in when there is one. */
function diagnosticLines(source: string, diagnostics: KumikiError[]): string[] {
  if (diagnostics.length === 0) return [];
  // `compile` returned diagnostics rather than throwing, so the source parsed.
  const tests = loadSource(source).defs.filter((e) => e.layer === "test");
  return diagnostics.map((d) => {
    const test = tests.find(
      ({ range }) => d.pos.line >= range.startLine && d.pos.line <= range.endLine,
    );
    return `${formatDiagnostic(d)}${test ? ` (in test "${test.name}")` : ""}`;
  });
}

export function printWarnings(source: string, warnings: KumikiError[]): void {
  for (const line of diagnosticLines(source, warnings)) console.error(line);
}
