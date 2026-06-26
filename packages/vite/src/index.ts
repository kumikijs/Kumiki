// Vite plugin for Kumiki — the build-integration ecosystem seam. It lets a normal
// Vite (and therefore Next/Astro/etc.) project `import App from "./app.kumiki"`:
// each `.kumiki` source is compiled to an ESM module that default-exports the
// compiled AppShape (no auto-mount — the importer owns mounting, typically via
// `mount` or `defineKumikiElement` from @kumikijs/runtime).
//
// The compiler core is browser-safe; the Node-only capability/runtime-bundle
// helpers live in @kumikijs/compiler/node and are used here (the plugin runs in
// Node during build/dev).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compile, generateDts } from "@kumikijs/compiler";
import {
  nodeRuntimeBundleReader,
  resolveBuiltinIcons,
  resolveCapabilities,
} from "@kumikijs/compiler/node";
import type { Plugin } from "vite";

export type KumikiPluginOptions = {
  /**
   * Inline the @kumikijs/runtime into each compiled module so it is
   * self-contained. When false, the module `import`s "@kumikijs/runtime"
   * (deduplicated by the bundler). Default: true.
   */
  bundle?: boolean;
  /**
   * Emit a sibling `<name>.kumiki.gen.ts` of typed helpers (Slots / Providers)
   * for each compiled file, for type-safe provider authoring. Written only when
   * its contents change. Default: false.
   */
  types?: boolean;
  /**
   * Promote a11y warnings (E07xx) to compile errors. Mirrors the dev-server
   * `--strict-a11y` flag (spec §10.7) so violations surface in Vite's error
   * overlay during development. Default: false.
   */
  strictA11y?: boolean;
};

/** Write `path` only if its current contents differ — avoids spurious watch churn. */
function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  writeFileSync(path, content);
}

const KUMIKI_RE = /\.kumiki$/;

/** Strip a Vite id's query/suffix (`/abs/app.kumiki?import` → `/abs/app.kumiki`). */
function cleanId(id: string): string {
  const q = id.indexOf("?");
  return q === -1 ? id : id.slice(0, q);
}

export function kumiki(options: KumikiPluginOptions = {}): Plugin {
  const bundle = options.bundle ?? true;
  return {
    name: "vite-plugin-kumiki",
    enforce: "pre",
    async transform(code, id) {
      const file = cleanId(id);
      if (!KUMIKI_RE.test(file)) return null;

      const baseOpts = {
        runtimeSpecifier: "@kumikijs/runtime",
        exportApp: true,
        bundle,
        ...(bundle ? { readRuntimeBundle: nodeRuntimeBundleReader } : {}),
        capabilities: resolveCapabilities(file),
        ...(options.strictA11y ? { strictA11y: true as const } : {}),
      } as const;

      const first = compile(code, baseOpts);
      if (first.kind !== "ok") {
        const detail = first.errors.map((e) => `  ${e.code} ${e.message}`).join("\n");
        this.error(`Kumiki compile failed (${file}):\n${detail}`);
      }

      // Auto-bundle referenced icons (#101). When the project has
      // @kumikijs/icons installed, look up each name surfaced by the first
      // pass and re-codegen with `icons` populated so only used paths reach
      // the output. When the package is absent we fall through; theme.icons
      // remains the manual escape hatch.
      let result = first;
      if (first.usedIcons.length > 0) {
        const registry = await resolveBuiltinIcons(file);
        if (registry) {
          const subset: Record<string, string> = {};
          for (const name of first.usedIcons) {
            const path = registry[name];
            if (typeof path === "string") subset[name] = path;
          }
          if (Object.keys(subset).length > 0) {
            const second = compile(code, { ...baseOpts, icons: subset });
            if (second.kind === "ok") result = second;
          }
        }
      }

      if (options.types) writeIfChanged(`${file}.gen.ts`, generateDts(result.program));

      return { code: result.js, map: null };
    },
  };
}

export default kumiki;
