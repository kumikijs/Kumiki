// Issue #71: per-app DCE. Two cross-package guards:
//
// 1. The compiler's TILE_FAMILY table and the runtime's tiles-* modules must
//    agree — a tile assigned to family X that the runtime renders in family Y
//    would make `kumiki build` ship an app whose tile has no renderer. The
//    runtime's graceful missing-tile fallback would hide that as a console
//    error, so we pin the mapping structurally here.
//
// 2. Every example must compile in modular mode and reference only runtime
//    modules that actually exist as build artifacts (the same set tsdown emits
//    to dist/modules — no anonymous chunks, no dangling imports).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TILES, compile, TILE_FAMILY } from "@kumikijs/compiler";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import {
  collectionTiles,
  inputTiles,
  layoutTiles,
  mediaTiles,
  overlayTiles,
  statusTiles,
  textTiles,
} from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");

const RUNTIME_FAMILIES = {
  layout: layoutTiles,
  text: textTiles,
  input: inputTiles,
  collection: collectionTiles,
  overlay: overlayTiles,
  media: mediaTiles,
  status: statusTiles,
} as const;

/** Every module file the runtime build emits to dist/modules (sans extension). */
const AVAILABLE_MODULES = new Set([
  "core",
  "stdlib",
  "testkit",
  "router",
  "effects-storage",
  "effects-indexed",
  "effects-http",
  "effects-toast",
  "effects-confirm",
  ...Object.keys(RUNTIME_FAMILIES).map((f) => `tiles-${f}`),
]);

function listExamples(): string[] {
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

describe("compiler TILE_FAMILY ⇆ runtime tiles-* modules (#71)", () => {
  it("assigns every built-in tile to exactly the runtime module that renders it", () => {
    for (const tile of BUILTIN_TILES) {
      const family = TILE_FAMILY[tile];
      expect(family, `TILE_FAMILY is missing "${tile}"`).toBeDefined();
      const renderers = RUNTIME_FAMILIES[family as keyof typeof RUNTIME_FAMILIES];
      expect(
        Object.hasOwn(renderers, tile),
        `tile "${tile}" mapped to family "${family}" but tiles-${family}.ts has no renderer for it`,
      ).toBe(true);
    }
  });

  it("the runtime modules define no tile the compiler doesn't know", () => {
    for (const [family, renderers] of Object.entries(RUNTIME_FAMILIES)) {
      for (const tile of Object.keys(renderers)) {
        expect(
          TILE_FAMILY[tile],
          `tiles-${family}.ts renders "${tile}" but TILE_FAMILY doesn't map it`,
        ).toBe(family);
      }
    }
  });
});

describe("every example compiles in modular mode with resolvable imports (#71)", () => {
  for (const file of listExamples()) {
    it(`modular-compiles ${file.split(/[\\/]/).slice(-2).join("/")}`, () => {
      const source = readFileSync(file, "utf8");
      const result = compile(source, {
        runtimeSpecifier: "unused",
        runtimeModulesDir: "./runtime",
        capabilities: resolveCapabilities(file),
      });
      if (result.kind === "fail") {
        throw new Error(`${file} failed to compile in modular mode`);
      }
      // The declared module list covers known artifacts only…
      for (const mod of result.runtimeModules) {
        expect(AVAILABLE_MODULES.has(mod), `unknown runtime module "${mod}"`).toBe(true);
      }
      // …and matches the imports the generated code actually contains.
      const imported = [...result.js.matchAll(/from "\.\/runtime\/([\w-]+)\.js"/g)].map(
        (m) => m[1],
      );
      expect(new Set(imported)).toEqual(new Set(result.runtimeModules));
    });
  }
});
