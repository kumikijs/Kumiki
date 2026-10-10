import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
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
import { allFiles, exampleLabel } from "@kumikijs/examples";
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

const require = createRequire(import.meta.url);
const modulesDir = dirname(require.resolve("@kumikijs/runtime/modules/core.js"));
const moduleUrl = (name: string): string => pathToFileURL(join(modulesDir, `${name}.js`)).href;

const RUNTIME_FAMILIES: Record<TileFamily, Record<string, unknown>> = {
  layout: layoutTiles,
  text: textTiles,
  input: inputTiles,
  collection: collectionTiles,
  overlay: overlayTiles,
  media: mediaTiles,
  status: statusTiles,
};

describe("compiler TILE_FAMILY ⇄ runtime tile modules", () => {
  it.each([...BUILTIN_TILES])("%s maps to the family whose module renders it", (tile) => {
    const family = TILE_FAMILY[tile];
    expect(family, `TILE_FAMILY is missing "${tile}"`).toBeDefined();
    expect(Object.keys(RUNTIME_FAMILIES[family as TileFamily])).toContain(tile);
  });

  it("the runtime renders no tile the compiler maps elsewhere or not at all", () => {
    const misplaced = Object.entries(RUNTIME_FAMILIES).flatMap(([family, renderers]) =>
      Object.keys(renderers)
        .filter((tile) => TILE_FAMILY[tile] !== family)
        .map((tile) => `${family}/${tile} → ${TILE_FAMILY[tile] ?? "unmapped"}`),
    );
    expect(misplaced).toEqual([]);
  });
});

describe("the runtime's dist/modules", () => {
  // `kumiki build` copies modules by name from the compiler's list, so a chunk the bundler
  // splits out under a generated name would ship as a dangling import; only an exact
  // comparison sees the extra file, since every expected name is still present.
  it("holds exactly the modules the compiler can ask for", () => {
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
      ...(Object.keys(RUNTIME_FAMILIES) as TileFamily[])
        .filter((family) => !isPerTileFamily(family))
        .map((family) => `tiles-${family}`),
      ...[...BUILTIN_TILES]
        .filter((tile) => isPerTileFamily(TILE_FAMILY[tile]))
        .map((tile) => tileModule(tile) as string),
      ...Object.values(PER_TILE_FAMILY_SHARED),
    ]);
    const built = readdirSync(modulesDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.slice(0, -".js".length));
    expect(built.sort()).toEqual([...expected].sort());
  });

  it.each(
    [...BUILTIN_TILES].filter((tile) => isPerTileFamily(TILE_FAMILY[tile])),
  )("%s's module exports the renderer and patcher codegen imports", async (tile) => {
    const stem = tile.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ moduleUrl(tileModule(tile) as string)
    );
    expect(typeof mod[`${stem}Tile`]).toBe("function");
    expect(typeof mod[`${stem}Patcher`]).toBe("function");
  });
});

describe("every example compiled in modular mode imports exactly the modules it declares", () => {
  const shared = new Set<string>([
    ...Object.values(PER_TILE_FAMILY_SHARED),
    EFFECT_HANDLERS_SHARED,
  ]);

  it.each(allFiles().map((file) => ({ file, name: exampleLabel(file) })))("$name", async ({
    file,
  }) => {
    const result = compile(readFileSync(file, "utf8"), {
      runtimeSpecifier: "unused",
      runtimeModulesDir: "./runtime",
      capabilities: resolveCapabilities(file),
    });
    if (result.kind === "fail") throw new Error(`${file} failed to compile in modular mode`);

    const imported = new Set(
      [...result.js.matchAll(/from "\.\/runtime\/([\w-]+)\.js"/g)].map((m) => m[1] as string),
    );
    const declared = new Set(result.runtimeModules);
    expect([...imported].filter((mod) => !declared.has(mod))).toEqual([]);
    expect([...declared].filter((mod) => !imported.has(mod) && !shared.has(mod))).toEqual([]);
    for (const mod of declared) {
      await expect(import(/* @vite-ignore */ moduleUrl(mod))).resolves.toBeDefined();
    }
  });
});
