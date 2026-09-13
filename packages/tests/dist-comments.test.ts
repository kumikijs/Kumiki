// The published `.js` artifacts carry no JSDoc (see `tsdown.shared.ts`): it is
// the largest single thing in the unminified bundles, and editors read it from
// the `.d.ts` instead. Two things must survive that strip, and neither shows up
// as a test failure anywhere else:
//
// 1. `@__PURE__` / `@__NO_SIDE_EFFECTS__` annotations — without them a
//    downstream bundler cannot make good on the runtime's `sideEffects: false`,
//    and the only symptom is a silently fatter app bundle.
// 2. `@kumikijs/runtime`'s `dist/index.js` staying unminified and inline-able:
//    `inlineRuntime` strips its trailing `export { … }` line and relies on the
//    top-level binding names still matching the export names.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineRuntime } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(here, "..");

/** Every package whose `dist` is published to npm. */
const PUBLISHED = ["cli", "compiler", "icons", "kumiki", "mcp", "runtime", "syntax", "vite"];

function distJsFiles(pkg: string): string[] {
  const dist = join(packagesDir, pkg, "dist");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      // `dist/dev/` is the CLI's dev-server client, copied verbatim rather than
      // built, so the comment policy does not reach it.
      return e.name.endsWith(".js") ? [p] : [];
    });
  return walk(dist).filter((p) => !p.includes(`${join("dist", "dev")}`));
}

/**
 * JSDoc blocks left in the output — counted only where one opens a line, so a
 * `/** … *\/` that codegen emits *into a string* (the `.gen.ts` provider
 * helpers do) is not mistaken for a doc block the build should have stripped.
 */
function jsdocBlocks(code: string): number {
  return (code.match(/^[ \t]*\/\*\*/gm) ?? []).length;
}

describe("published dist carries no JSDoc", () => {
  for (const pkg of PUBLISHED) {
    it(`${pkg} — every dist/*.js`, () => {
      const files = distJsFiles(pkg);
      expect(files.length).toBeGreaterThan(0);
      const offenders = files
        .map((f) => [f, jsdocBlocks(readFileSync(f, "utf8"))] as const)
        .filter(([, n]) => n > 0)
        .map(([f, n]) => `${f} (${n})`);
      expect(offenders).toEqual([]);
    });
  }

  it("ships no authored prose at all, not only no JSDoc", () => {
    // The setting is named `jsdoc: false`, but rolldown drops authored `//`
    // comments regardless — so "no JSDoc" understates what `dist` actually
    // carries. Pin the stronger property, and pin that the `#region` markers
    // the linker emits are what is left, so a future toolchain that started
    // keeping prose again would fail here rather than quietly re-inflating
    // every published bundle.
    const bundle = readFileSync(join(packagesDir, "runtime", "dist", "index.js"), "utf8");
    const lineComments = bundle.split("\n").filter((l) => /^\s*\/\//.test(l));
    expect(lineComments.length).toBeGreaterThan(0);
    expect(lineComments.filter((l) => !/#(end)?region/.test(l))).toEqual([]);
  });

  it("keeps the JSDoc in the .d.ts, which is what editors read", () => {
    const dts = readFileSync(join(packagesDir, "runtime", "dist", "index.d.ts"), "utf8");
    expect(jsdocBlocks(dts)).toBeGreaterThan(0);
  });
});

describe("@kumikijs/runtime dist/index.js stays inline-able", () => {
  const bundlePath = join(packagesDir, "runtime", "dist", "index.js");
  const bundle = readFileSync(bundlePath, "utf8");

  it("keeps the tree-shaking annotations", () => {
    expect(bundle).toContain("__PURE__");
  });

  it("is not minified — declarations stay on their own indented lines", () => {
    const lines = bundle.split("\n");
    expect(lines.length).toBeGreaterThan(1000);
    // A minified ESM chunk is a handful of very long lines; a readable one is
    // not. Guard the property the AI debug loop depends on (stack traces point
    // at a line you can read) rather than the exact formatting.
    const longest = Math.max(...lines.map((l) => l.length));
    expect(longest).toBeLessThan(2000);
  });

  it("ends with the single `export { … }` line inlineRuntime strips", () => {
    const inlined = inlineRuntime('import { mount } from "@kumikijs/runtime";\nmount();\n', bundle);
    expect(inlined).not.toMatch(/^export \{/m);
    expect(inlined).not.toMatch(/^import \{/m);
    expect(inlined).toContain("mount();");
    // The binding the stripped import referred to is still declared in the
    // inlined runtime, under the same name.
    expect(inlined).toMatch(/\bfunction mount\b|\bconst mount\b/);
  });

  it("is smaller than the same bundle would be with its JSDoc", () => {
    // A floor, not a target: it fails loudly if the comment policy is dropped
    // (that build is ~296 kB) without pinning the byte count of every edit.
    expect(statSync(bundlePath).size).toBeLessThan(260 * 1024);
  });
});
