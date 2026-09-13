import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

// @kumikijs/runtime has no runtime dependencies. Three artifact sets are built
// from the same source:
//
// - `index` — readable ESM, the whole runtime in one file. The package entry,
//   and the `./bundle` export that codegen inlines into generated apps for
//   smoke/run/test. It MUST stay unminified: `inlineRuntime` strips the
//   `export { … }` line and relies on the top-level binding names matching the
//   export names, and the AI debug loop reads its stack traces. Its JSDoc is
//   stripped all the same (`publishedOutputOptions`) — that costs neither
//   guarantee, and it is 39% of this artifact gzipped.
// - `bundle.min` — the same single file, minified ESM (`./bundle.min`). Kept
//   for hosts that want the full runtime as one request.
// - `dist/modules/*` — the granular feature modules (#71), minified. `kumiki
//   build` copies only the ones a compiled app imports (core + stdlib + the
//   used tile modules / router / effect handlers). A family on the compiler's
//   `PER_TILE_FAMILIES` has one entry PER TILE (`tiles-text-link`) instead of
//   one for the family, so an app with a heading does not download the link
//   tile's URL-disposition check. `core`, `stdlib` and
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
    outputOptions: publishedOutputOptions,
  },
  {
    entry: { "bundle.min": "src/index.ts" },
    format: "esm",
    dts: false,
    fixedExtension: false,
    minify: true,
    // The first config already cleaned dist/; cleaning here would race it.
    clean: false,
    outputOptions: publishedOutputOptions,
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
      "tiles-text-heading": "src/tiles/text/heading.ts",
      "tiles-text-text": "src/tiles/text/text.ts",
      "tiles-text-label": "src/tiles/text/label.ts",
      "tiles-text-link": "src/tiles/text/link.ts",
      "tiles-text-markdown": "src/tiles/text/markdown.ts",
      "tiles-text-code": "src/tiles/text/code.ts",
      "tiles-text-icon": "src/tiles/text/icon.ts",
      "tiles-input-shared": "src/tiles/input/_shared.ts",
      "tiles-input-button": "src/tiles/input/button.ts",
      "tiles-input-input": "src/tiles/input/input.ts",
      "tiles-input-textarea": "src/tiles/input/textarea.ts",
      "tiles-input-check": "src/tiles/input/check.ts",
      "tiles-input-radio": "src/tiles/input/radio.ts",
      "tiles-input-select": "src/tiles/input/select.ts",
      "tiles-input-slider": "src/tiles/input/slider.ts",
      "tiles-input-switch": "src/tiles/input/switch.ts",
      "tiles-input-form": "src/tiles/input/form.ts",
      "tiles-input-editable": "src/tiles/input/editable.ts",
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
    outputOptions: publishedOutputOptions,
  },
]);
