import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

// @kumikijs/syntax ships the Kumiki TextMate grammar as a typed JS object.
// The JSON is imported and inlined into the bundle; the raw .json is published
// separately (see package.json "files" + the "./grammar.json" export).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  // Emit .js/.d.ts (honors "type": "module") instead of tsdown's node-default .mjs.
  fixedExtension: false,
  outputOptions: publishedOutputOptions,
});
