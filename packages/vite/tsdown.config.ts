import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

// @kumikijs/vite is a thin plugin over @kumikijs/compiler. The compiler (and its
// Node helpers) are kept external so the plugin reuses the installed copy rather
// than inlining it.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  // Emit .js/.d.ts (honors "type": "module") instead of tsdown's node-default .mjs.
  fixedExtension: false,
  external: [/^@kumikijs\//, "vite"],
  outputOptions: publishedOutputOptions,
});
