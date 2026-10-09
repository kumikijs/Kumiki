import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BUILTIN_TILES,
  compile,
  EFFECT_HANDLERS_SHARED,
  isPerTileFamily,
  PER_TILE_FAMILY_SHARED,
  TILE_FAMILY,
  type TileFamily,
  tileModule,
} from "@kumikijs/compiler";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import { allFiles } from "@kumikijs/examples";
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
const packagesDir = join(here, "..", "..");

const RUNTIME_FAMILIES = {
  layout: layoutTiles,
  text: textTiles,
  input: inputTiles,
  collection: collectionTiles,
  overlay: overlayTiles,
  media: mediaTiles,
  status: statusTiles,
} as const;

const AVAILABLE_MODULES = new Set(
  readdirSync(join(packagesDir, "runtime", "dist", "modules"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3)),
);

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
    const expected = new Set<string>([
      "core",
      "stdlib",
      "testkit",
      "router",
      EFFECT_HANDLERS_SHARED,
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
  for (const file of allFiles()) {
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
      const imported = new Set(
        [...result.js.matchAll(/from "\.\/runtime\/([\w-]+)\.js"/g)].map((m) => m[1] as string),
      );
      const declared = new Set(result.runtimeModules);
      const shared = new Set([...Object.values(PER_TILE_FAMILY_SHARED), EFFECT_HANDLERS_SHARED]);
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
