import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

export default defineConfig({
  entry: { kumiki: "src/kumiki.ts" },
  format: "esm",
  dts: false,
  fixedExtension: false,
  outputOptions: publishedOutputOptions,
});
