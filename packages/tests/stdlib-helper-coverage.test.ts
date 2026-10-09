import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codegen, lex, parse } from "@kumikijs/compiler";
import { _stdlib } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const examplesDir = join(repoRoot, "packages", "examples");
const codegenDir = join(repoRoot, "packages", "compiler", "src", "codegen");

const HELPER_RE = /_s\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

/** The names `_s` can resolve to at runtime, in either build shape. */
const available = new Set(Object.keys(_stdlib));

function helpersIn(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(HELPER_RE)) names.add(m[1] as string);
  return names;
}

function filesUnder(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function exampleSources(): string[] {
  const features = readdirSync(join(examplesDir, "features"))
    .filter((f) => f.endsWith(".kumiki"))
    .map((f) => join(examplesDir, "features", f));
  const apps = readdirSync(join(examplesDir, "apps"))
    .map((name) => join(examplesDir, "apps", name, "app.kumiki"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
  return [...features, ...apps];
}

describe("every `_s.<helper>` codegen emits exists in the runtime stdlib", () => {
  const MIN_HELPERS = 20;

  it("holds for the lowerings written in codegen's own sources", () => {
    const written = new Set<string>();
    for (const file of filesUnder(codegenDir, ".ts")) {
      for (const name of helpersIn(readFileSync(file, "utf8"))) written.add(name);
    }
    expect(written.size).toBeGreaterThan(MIN_HELPERS);
    expect([...written].filter((n) => !available.has(n)).sort()).toEqual([]);
  });

  it("holds for the JS every example generates", () => {
    // Unbundled: `bundle: true` inlines the runtime, whose own `_s.` mentions are not lowerings and would be scanned as though they were.
    const used = new Set<string>();
    for (const file of exampleSources()) {
      const { js } = codegen(parse(lex(readFileSync(file, "utf8"))), {
        runtimeSpecifier: "./runtime.js",
      });
      for (const name of helpersIn(js)) used.add(name);
    }
    expect(used.size).toBeGreaterThan(MIN_HELPERS);
    expect([...used].filter((n) => !available.has(n)).sort()).toEqual([]);
  });
});
