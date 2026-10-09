import { readFileSync } from "node:fs";
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
  tileModule,
} from "@kumikijs/compiler";
import { resolveCapabilities } from "@kumikijs/compiler/node";
import { allFiles, exampleLabel } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const modulesDir = dirname(require.resolve("@kumikijs/runtime/modules/core.js"));
const moduleUrl = (name: string): string => pathToFileURL(join(modulesDir, `${name}.js`)).href;

describe("the per-tile runtime modules", () => {
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
