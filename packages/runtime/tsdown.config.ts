import { defineConfig } from "tsdown";

// @kumikijs/runtime has no runtime dependencies. Three artifact sets are built
// from the same source:
//
// - `index` — readable ESM, the whole runtime in one file. The package entry,
//   and the `./bundle` export that codegen inlines into generated apps for
//   smoke/run/test. It MUST stay unminified: `inlineRuntime` strips the
//   `export { … }` line and relies on the top-level binding names matching the
//   export names, and the AI debug loop reads its stack traces.
// - `bundle.min` — the same single file, minified ESM (`./bundle.min`). Kept
//   for hosts that want the full runtime as one request.
// - `dist/modules/*` — the granular feature modules (#71), minified. `kumiki
//   build` copies only the ones a compiled app imports (core + stdlib + the
//   used tile families / router / effect handlers). `core`, `stdlib` and
//   `testkit` are entries of the same build, so cross-module imports resolve
//   to those entry chunks — no anonymous shared chunks may appear (the CLI
//   tests assert the exact file set).
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: "esm",
    dts: true,
    // Emit .js/.d.ts (honors "type": "module") instead of tsdown's node-default .mjs.
    fixedExtension: false,
  },
  {
    entry: { "bundle.min": "src/index.ts" },
    format: "esm",
    dts: false,
    fixedExtension: false,
    minify: true,
    // The first config already cleaned dist/; cleaning here would race it.
    clean: false,
  },
  {
    entry: {
      core: "src/core.ts",
      stdlib: "src/stdlib.ts",
      testkit: "src/testkit.ts",
      router: "src/router.ts",
      "effects-storage": "src/effects-storage.ts",
      "effects-indexed": "src/effects-indexed.ts",
      "effects-http": "src/effects-http.ts",
      "effects-toast": "src/effects-toast.ts",
      "effects-confirm": "src/effects-confirm.ts",
      "tiles-layout": "src/tiles-layout.ts",
      "tiles-text": "src/tiles-text.ts",
      "tiles-input": "src/tiles-input.ts",
      "tiles-collection": "src/tiles-collection.ts",
      "tiles-overlay": "src/tiles-overlay.ts",
      "tiles-media": "src/tiles-media.ts",
      "tiles-status": "src/tiles-status.ts",
    },
    outDir: "dist/modules",
    format: "esm",
    dts: false,
    fixedExtension: false,
    minify: true,
    clean: false,
  },
]);
