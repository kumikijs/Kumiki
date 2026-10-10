import { defineConfig } from "tsdown";

import { publishedOutputOptions } from "../../tsdown.shared.ts";

export default defineConfig({
  entry: { index: "src/index.ts", kumiki: "src/kumiki.ts" },
  format: "esm",
  dts: true,
  fixedExtension: false,
  // A directory copy lands inside `to`, giving dist/dev/*.ts, where src/dev.ts reads them.
  copy: [{ from: "src/dev/", to: "dist/" }],
  outputOptions: publishedOutputOptions,
});
