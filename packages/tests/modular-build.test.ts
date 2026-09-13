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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUILTIN_TILES,
  compile,
  isPerTileFamily,
  PER_TILE_FAMILIES,
  PER_TILE_FAMILY_SHARED,
  TILE_FAMILY,
  type TileFamily,
  tileModule,
} from "@kumikijs/compiler";
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
const packagesDir = join(here, "..");
const examplesDir = join(packagesDir, "examples");

const RUNTIME_FAMILIES = {
  layout: layoutTiles,
  text: textTiles,
  input: inputTiles,
  collection: collectionTiles,
  overlay: overlayTiles,
  media: mediaTiles,
  status: statusTiles,
} as const;

/**
 * Every module file the runtime build emits to dist/modules (sans extension),
 * read from the build rather than listed here: the set changed once already
 * (families to per-tile modules, #71) and a hand-kept copy would have said the
 * new names were unknown while the build was emitting them. `test` depends on
 * `^build`, so this directory is the runtime's current output.
 */
const AVAILABLE_MODULES = new Set(
  readdirSync(join(packagesDir, "runtime", "dist", "modules"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3)),
);

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

  it("gives every tile of a per-tile family its own built module", () => {
    // The module name is derived from the kind (`tiles-text-link`), so a kind
    // added to one of these families without a matching runtime entry compiles
    // to an import of a file that was never built — a blank page, and `check`
    // and `build` both pass.
    for (const tile of BUILTIN_TILES) {
      if (!isPerTileFamily(TILE_FAMILY[tile])) continue;
      const mod = tileModule(tile);
      expect(mod, `no module name for "${tile}"`).toBeDefined();
      expect(
        AVAILABLE_MODULES.has(mod as string),
        `tile "${tile}" needs dist/modules/${mod}.js, which the runtime build does not emit`,
      ).toBe(true);
    }
    for (const shared of Object.values(PER_TILE_FAMILY_SHARED)) {
      expect(AVAILABLE_MODULES.has(shared), `missing dist/modules/${shared}.js`).toBe(true);
    }
  });

  it("emits exactly the module set the compiler can ask for, and nothing else", async () => {
    // The anonymous-chunk guard. `dist/modules` is built from 19 tile entries
    // sharing `tiles/input/_shared.ts`; if that stopped resolving to its own
    // entry chunk, rolldown would emit a shared chunk under a generated name,
    // every tile module would import it, and `kumiki build` — which copies by
    // NAME, from the compiler's list — would ship a dangling import. Presence
    // checks cannot see that, because the named files it looks for are all
    // still there. Only an exact comparison can.
    const expected = new Set<string>([
      "core",
      "stdlib",
      "testkit",
      "router",
      "effects-storage",
      "effects-indexed",
      "effects-http",
      "effects-toast",
      "effects-confirm",
      ...Object.keys(RUNTIME_FAMILIES)
        .filter((f) => !isPerTileFamily(f as TileFamily))
        .map((f) => `tiles-${f}`),
      ...[...BUILTIN_TILES]
        .filter((t) => isPerTileFamily(TILE_FAMILY[t]))
        .map((t) => tileModule(t) as string),
      ...Object.values(PER_TILE_FAMILY_SHARED),
    ]);
    expect([...AVAILABLE_MODULES].sort()).toEqual([...expected].sort());
  });

  it("exports each per-tile module under the names codegen imports", async () => {
    // Codegen writes `import { selectTile, selectPatcher } from
    // "./runtime/tiles-input-select.js"` from `tileVar` / `tilePatcherVar`,
    // which derive the names from the kind. Rename `selectTile` in the runtime
    // and every tier stays green — typecheck never sees the generated import,
    // and the family aggregate still re-exports under its own name — while a
    // built app gets `undefined` in `_tiles` and renders a blank tile. That is
    // the failure mode #71's own notes warn about; this is the guard.
    const modulesDir = join(packagesDir, "runtime", "dist", "modules");
    for (const tile of BUILTIN_TILES) {
      if (!isPerTileFamily(TILE_FAMILY[tile])) continue;
      const stem = tile.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
      const mod: Record<string, unknown> = await import(
        /* @vite-ignore */ pathToFileURL(join(modulesDir, `${tileModule(tile)}.js`)).href
      );
      expect(typeof mod[`${stem}Tile`], `${tile}: missing ${stem}Tile`).toBe("function");
      expect(typeof mod[`${stem}Patcher`], `${tile}: missing ${stem}Patcher`).toBe("function");
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
      // …and matches the imports the generated code actually contains, except
      // for a per-tile family's shared module: the tile modules reach it
      // relatively, so it is copied without appearing in the header. Anything
      // else declared-but-unimported is a module shipped for no reason, and
      // anything imported-but-undeclared is a dangling import at runtime.
      const imported = new Set(
        [...result.js.matchAll(/from "\.\/runtime\/([\w-]+)\.js"/g)].map((m) => m[1] as string),
      );
      const declared = new Set(result.runtimeModules);
      const shared = new Set(Object.values(PER_TILE_FAMILY_SHARED));
      for (const mod of imported) {
        expect(declared.has(mod), `imported "${mod}" but did not declare it`).toBe(true);
      }
      for (const mod of declared) {
        if (imported.has(mod) || shared.has(mod)) continue;
        throw new Error(`declared "${mod}" but nothing imports it`);
      }
    });
  }
});
