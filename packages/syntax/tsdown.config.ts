import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  dts: true,
  fixedExtension: false,
  outputOptions: publishedOutputOptions,
});
