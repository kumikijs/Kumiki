import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

export default defineConfig([
  // One unminified file: inlineRuntime strips its trailing export line and relies on the
  // top-level names matching the export names.
  {
    entry: { index: "src/index.ts" },
    format: "esm",
    dts: true,
    fixedExtension: false,
    outputOptions: publishedOutputOptions,
  },
  // Its own build, so index.js inlines the code it shares with these subpaths instead of
  // importing it from a shared chunk.
  {
    entry: { "text-distance": "src/text-distance.ts", "positive-int": "src/positive-int.ts" },
    format: "esm",
    dts: true,
    fixedExtension: false,
    clean: false,
    outputOptions: publishedOutputOptions,
  },
  {
    entry: { "bundle.min": "src/index.ts" },
    format: "esm",
    dts: false,
    fixedExtension: false,
    minify: true,
    clean: false,
    outputOptions: publishedOutputOptions,
  },
  {
    entry: {
      core: "src/core.ts",
      stdlib: "src/stdlib.ts",
      testkit: "src/testkit.ts",
      router: "src/router.ts",
      "effects-decode": "src/effects-decode.ts",
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
    // Lets an entry chunk export more than its own signature, so code another entry imports
    // from it stays in that entry instead of moving to a chunk of its own.
    inputOptions: { preserveEntrySignatures: "allow-extension" },
    outputOptions: publishedOutputOptions,
  },
]);
