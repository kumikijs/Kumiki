import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineRuntime } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const PUBLISHED = ["cli", "compiler", "icons", "kumiki", "mcp", "runtime", "syntax", "vite"];

function distJsFiles(pkg: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith(".js") ? [path] : [];
    });
  return walk(join(packagesDir, pkg, "dist"));
}

// Counted only where a block opens a line, so a `/**` codegen writes into a string literal
// (the vite plugin's .gen.ts helpers) is not mistaken for a doc block.
const jsdocBlocks = (code: string): number => (code.match(/^[ \t]*\/\*\*/gm) ?? []).length;

const runtimeDist = (file: string): string =>
  readFileSync(join(packagesDir, "runtime", "dist", file), "utf8");

describe("published dist comments", () => {
  it.each(PUBLISHED)("%s's dist/*.js carries no JSDoc", (pkg) => {
    const files = distJsFiles(pkg);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => jsdocBlocks(readFileSync(f, "utf8")) > 0);
    expect(offenders).toEqual([]);
  });

  it("keeps the JSDoc in the .d.ts editors read", () => {
    expect(jsdocBlocks(runtimeDist("index.d.ts"))).toBeGreaterThan(0);
  });

  it("keeps the tree-shaking annotations in the runtime bundle", () => {
    expect(runtimeDist("index.js")).toMatch(/\/\* @__PURE__ \*\//);
  });
});

describe("the runtime's dist/index.js stays inlineable", () => {
  const bundle = runtimeDist("index.js");

  it("is not minified", () => {
    const lines = bundle.split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(2000);
  });

  it("ends in the one export line inlineRuntime strips, with matching top-level names", () => {
    const inlined = inlineRuntime('import { mount } from "@kumikijs/runtime";\nmount();\n', bundle);
    expect(inlined).not.toMatch(/^export \{/m);
    expect(inlined).not.toMatch(/^import \{/m);
    expect(inlined).toContain("mount();");
    expect(inlined).toMatch(/\bfunction mount\b|\bconst mount\b/);
  });
});
